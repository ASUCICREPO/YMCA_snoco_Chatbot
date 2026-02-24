import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as stepfunctionsTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as s3Notifications from 'aws-cdk-lib/aws-s3-notifications';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as amplifyAlpha from '@aws-cdk/aws-amplify-alpha';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';
import { Bucket, Index } from 'cdk-s3-vectors';
import { CfnKnowledgeBase, CfnDataSource } from 'aws-cdk-lib/aws-bedrock';
import { NagSuppressions } from 'cdk-nag';

// Load environment variables from backend/.env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

export class YmcaAiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Allowed origins for CORS - update if Amplify app URL changes
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      'https://main.d22qq7yri8hpql.amplifyapp.com',
    ];

    // S3 access logs bucket (required by AwsSolutions-S1)
    const accessLogsBucket = new s3.Bucket(this, 'YmcaAccessLogsBucket', {
      bucketName: `ymca-access-logs-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
    });

    // S3 Bucket for document storage with input/ and output/ prefixes
    // input/ - stores initial documents uploaded for processing
    // output/ - stores processed output from textract pipeline (used by Bedrock Knowledge Base)
    const documentsBucket = new s3.Bucket(this, 'YmcaDocumentsBucket', {
      // Use a static name to prevent replacement on updates (removed Date.now())
      bucketName: process.env.DOCUMENTS_BUCKET || `ymca-documents-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: 'documents-bucket/',
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.DELETE,
            s3.HttpMethods.HEAD,
          ],
          allowedOrigins: allowedOrigins, // Restrict to known origins
          allowedHeaders: ['*'],
          exposedHeaders: [
            'ETag',
            'x-amz-server-side-encryption',
            'x-amz-request-id',
            'x-amz-id-2',
          ],
          maxAge: 3000,
        },
      ],
    });

    // ========================================================================
    // S3 VECTORS AND BEDROCK KNOWLEDGE BASE
    // ========================================================================

    // Create S3 Vectors bucket and index
    const vectorsBucket = new Bucket(this, 'YmcaVectorsBucket', {
      vectorBucketName: `ymca-vectors-${this.account}-${this.region}`,
    });

    const vectorIndex = new Index(this, 'YmcaVectorIndex', {
      vectorBucketName: vectorsBucket.vectorBucketName,
      indexName: 'ymca-vector-index',
      dimension: 1024, // Titan Text Embeddings V2 dimension
      distanceMetric: 'cosine',
      dataType: 'float32',
      metadataConfiguration: {
        nonFilterableMetadataKeys: [
          'AMAZON_BEDROCK_TEXT',
          'AMAZON_BEDROCK_METADATA',
        ]
      }
    });

    // Create IAM role for Bedrock Knowledge Base
    const knowledgeBaseRole = new iam.Role(this, 'YmcaKnowledgeBaseRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      // No AmazonS3ReadOnlyAccess managed policy - documentsBucket.grantRead() below is sufficient
    });

    // Grant S3 Vectors permissions - resource scoping not supported for new s3vectors service
    knowledgeBaseRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3vectors:CreateIndex',
        's3vectors:GetIndex',
        's3vectors:DeleteIndex',
        's3vectors:PutVectors',
        's3vectors:GetVectors',
        's3vectors:DeleteVectors',
        's3vectors:QueryVectors',
        's3vectors:ListIndexes',
      ],
      resources: ['*'], // s3vectors ARN format not yet documented; tighten when available
    }));

    // Grant Bedrock model invocation permissions - scoped to embedding model only
    knowledgeBaseRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
      ],
    }));

    // Grant access to documents bucket
    documentsBucket.grantRead(knowledgeBaseRole);

    // Create Bedrock Knowledge Base
    const knowledgeBase = new CfnKnowledgeBase(this, 'YmcaKnowledgeBase', {
      name: 'ymca-knowledge-base',
      roleArn: knowledgeBaseRole.roleArn,
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn: `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
        },
      },
      storageConfiguration: {
        type: 'S3_VECTORS',
        s3VectorsConfiguration: {
          indexArn: vectorIndex.indexArn,
          vectorBucketArn: vectorsBucket.vectorBucketArn, // Use the correct property from the construct
        },
      },
    });

    // Create data source for the Knowledge Base
    const dataSource = new CfnDataSource(this, 'YmcaKnowledgeBaseDataSource', {
      knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
      name: 'ymca-s3-documents',
      dataSourceConfiguration: {
        type: 'S3',
        s3Configuration: {
          bucketArn: documentsBucket.bucketArn,
          inclusionPrefixes: ['output/processed-text/']
        },
      },
      vectorIngestionConfiguration: {
        chunkingConfiguration: {
          chunkingStrategy: 'FIXED_SIZE',
          fixedSizeChunkingConfiguration: {
            maxTokens: 525,
            overlapPercentage: 15,
          },
        },
      },
      dataDeletionPolicy: 'RETAIN',
    });

    // DynamoDB Tables for analytics and conversation tracking
    const conversationTable = new dynamodb.Table(this, 'YmcaConversationTable', {
      tableName: process.env.CONVERSATION_TABLE || 'ymca-conversations',
      partitionKey: { name: 'conversationId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const analyticsTable = new dynamodb.Table(this, 'YmcaAnalyticsTable', {
      tableName: process.env.ANALYTICS_TABLE || 'ymca-analytics',
      partitionKey: { name: 'queryId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // IAM Role for Lambda functions (excluding batch processor)
    const lambdaExecutionRole = new iam.Role(this, 'YmcaLambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        YmcaAiPolicy: new iam.PolicyDocument({
          statements: [
            // S3 permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
                's3:ListBucket',
              ],
              resources: [
                documentsBucket.bucketArn,
                `${documentsBucket.bucketArn}/*`,
              ],
            }),
            // DynamoDB permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'dynamodb:GetItem',
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
                'dynamodb:DeleteItem',
                'dynamodb:Query',
                'dynamodb:Scan',
              ],
              resources: [
                conversationTable.tableArn,
                analyticsTable.tableArn,
              ],
            }),
            // Textract permissions - resources: ['*'] required (Textract doesn't support resource-level permissions)
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'textract:StartDocumentTextDetection',
                'textract:GetDocumentTextDetection',
                'textract:StartDocumentAnalysis',
                'textract:GetDocumentAnalysis',
              ],
              resources: ['*'], // AWS limitation: Textract does not support resource-level ARNs
            }),
            // Bedrock permissions - scoped to specific models used by this application
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:InvokeModel',
                'bedrock:InvokeModelWithResponseStream',
              ],
              resources: [
                `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
                // Nova Pro via cross-region inference profile (us. prefix routes to us-east-1/us-west-2)
                `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.amazon.nova-pro-v1:0`,
                // Underlying Nova Pro foundation model - required in all US regions for cross-region inference
                `arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-pro-v1:0`,
                `arn:aws:bedrock:us-east-2::foundation-model/amazon.nova-pro-v1:0`,
                `arn:aws:bedrock:us-west-2::foundation-model/amazon.nova-pro-v1:0`,
              ],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:Retrieve',
                'bedrock:RetrieveAndGenerate',
                'bedrock:ListKnowledgeBases',
                'bedrock:GetKnowledgeBase',
                'bedrock:StartIngestionJob',
                'bedrock:GetDataSource',
                'bedrock:ListDataSources',
              ],
              resources: [
                `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/*`,
              ],
            }),
            // Translate/Comprehend - resources: ['*'] required (these services don't support resource-level ARNs)
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'translate:TranslateText',
                'comprehend:DetectDominantLanguage',
              ],
              resources: ['*'], // AWS limitation: Translate and Comprehend do not support resource-level ARNs
            }),
          ],
        }),
      },
    });

    // Separate IAM Role for Batch Processor (will get Step Functions permissions later)
    const batchProcessorRole = new iam.Role(this, 'YmcaBatchProcessorRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        S3Policy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['s3:GetObject'],
              resources: [`${documentsBucket.bucketArn}/*`],
            }),
          ],
        }),
      },
    });

    // Lambda function for streaming requests with response streaming enabled
    const agentProxyStreamingFunction = new lambda.Function(this, 'YmcaAgentProxyStreamingFunction', {
      functionName: 'ymca-agent-proxy-streaming',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.streamingHandler',
      code: lambda.Code.fromAsset('lambda/agent-proxy'),
      role: lambdaExecutionRole,
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
      environment: {
        CONVERSATION_TABLE_NAME: conversationTable.tableName,
        ANALYTICS_TABLE_NAME: analyticsTable.tableName,
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        KNOWLEDGE_BASE_ID: knowledgeBase.attrKnowledgeBaseId,
        REGION: this.region,
      },
    });

    // Add Function URL with streaming enabled for the streaming function
    const streamingFunctionUrl = agentProxyStreamingFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
      cors: {
        allowedOrigins: allowedOrigins,
        allowedMethods: [lambda.HttpMethod.POST],
        allowedHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'X-Amz-Security-Token'],
      },
    });

    // Document processing Lambda functions using external code
    const batchProcessorFunction = new lambda.Function(this, 'YmcaBatchProcessorFunction', {
      functionName: 'ymca-batch-processor',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/batch-processor'),
      role: batchProcessorRole,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: {
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        REGION: process.env.AWS_REGION || this.region,
        // STEP_FUNCTION_ARN will be added after workflow creation
      },
    });

    const textractAsyncFunction = new lambda.Function(this, 'YmcaTextractAsyncFunction', {
      functionName: 'ymca-textract-async',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/textract-async'),
      role: lambdaExecutionRole,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: {
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        REGION: process.env.AWS_REGION || this.region,
      },
    });

    const textractPostprocessorFunction = new lambda.Function(this, 'YmcaTextractPostprocessorFunction', {
      functionName: 'ymca-textract-postprocessor',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/textract-postprocessor'),
      role: lambdaExecutionRole,
      timeout: cdk.Duration.minutes(15), // Keep 15 minutes for processing large documents
      memorySize: 2048, // Increase memory for large document processing
      environment: {
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        REGION: process.env.AWS_REGION || this.region,
        KNOWLEDGE_BASE_ID: knowledgeBase.attrKnowledgeBaseId,
        DATA_SOURCE_ID: dataSource.attrDataSourceId,
      },
    });

    const checkTextractStatusFunction = new lambda.Function(this, 'YmcaCheckTextractStatusFunction', {
      functionName: 'ymca-check-textract-status',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/check-textract-status'),
      role: lambdaExecutionRole,
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      environment: {
        REGION: process.env.AWS_REGION || this.region,
      },
    });

    // Cognito User Pool for Admin Authentication
    const userPool = new cognito.UserPool(this, 'YmcaAdminUserPoolV2', {
      userPoolName: 'ymca-admin-user-pool-v2',
      selfSignUpEnabled: false, // Admins created manually in AWS Console only
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      // advancedSecurityMode: cognito.AdvancedSecurityMode.ENFORCED, // Requires Cognito PLUS tier (paid)
      // AUDIT mode logs suspicious activity without blocking - available on ESSENTIALS (free) tier
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Allow cleanup for dev
    });

    const userPoolClient = userPool.addClient('YmcaAdminUserPoolClient', {
      userPoolClientName: 'ymca-admin-client',
      generateSecret: false, // Web clients can't handle secrets
      authFlows: {
        userSrp: true,
      },
    });

    // Cognito Identity Pool for AWS credentials
    const identityPool = new cognito.CfnIdentityPool(this, 'YmcaAdminIdentityPool', {
      identityPoolName: 'ymca-admin-identity-pool',
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [{
        clientId: userPoolClient.userPoolClientId,
        providerName: userPool.userPoolProviderName,
      }],
    });

    // IAM Role for authenticated users
    const authenticatedRole = new iam.Role(this, 'YmcaAdminAuthenticatedRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: {
            'cognito-identity.amazonaws.com:aud': identityPool.ref,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'authenticated',
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
    });

    // Grant DynamoDB read access to authenticated users
    analyticsTable.grantReadData(authenticatedRole);
    conversationTable.grantReadData(authenticatedRole);

    // Grant S3 write access to authenticated users for document uploads
    documentsBucket.grantPut(authenticatedRole, 'input/*');

    // Attach role to identity pool
    new cognito.CfnIdentityPoolRoleAttachment(this, 'YmcaIdentityPoolRoleAttachment', {
      identityPoolId: identityPool.ref,
      roles: {
        authenticated: authenticatedRole.roleArn,
      },
    });


    // Step Functions workflow for document processing pipeline
    const documentProcessingWorkflow = this.createDocumentProcessingWorkflow(
      textractAsyncFunction,
      textractPostprocessorFunction,
      checkTextractStatusFunction
    );

    // S3 event notification to trigger document processing workflow
    documentsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3Notifications.LambdaDestination(batchProcessorFunction),
      { prefix: 'input/' }
    );

    // Update batch processor to trigger Step Functions - do this after workflow creation
    batchProcessorFunction.addEnvironment('STEP_FUNCTION_ARN', documentProcessingWorkflow.stateMachineArn);
    documentProcessingWorkflow.grantStartExecution(batchProcessorFunction);

    // Add Step Functions permissions to batch processor role
    batchProcessorRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'states:StartExecution',
        'states:DescribeExecution',
      ],
      resources: [documentProcessingWorkflow.stateMachineArn],
    }));

    // Outputs for reference
    new cdk.CfnOutput(this, 'StreamingFunctionUrl', {
      value: streamingFunctionUrl.url,
      description: 'Lambda Function URL with native streaming support (recommended for streaming)',
    });

    new cdk.CfnOutput(this, 'DocumentsBucketName', {
      value: documentsBucket.bucketName,
      description: 'S3 bucket for YMCA documents (input/ for uploads, output/ for Bedrock Knowledge Base)',
    });

    new cdk.CfnOutput(this, 'ConversationTableName', {
      value: conversationTable.tableName,
      description: 'DynamoDB table for conversation storage',
    });

    new cdk.CfnOutput(this, 'AnalyticsTableName', {
      value: analyticsTable.tableName,
      description: 'DynamoDB table for analytics data',
    });

    new cdk.CfnOutput(this, 'DocumentProcessingWorkflowArn', {
      value: documentProcessingWorkflow.stateMachineArn,
      description: 'Step Functions state machine for document processing pipeline',
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID for Admin Auth',
      exportName: `${this.stackName}-UserPoolId`,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: `${this.stackName}-UserPoolClientId`,
    });

    new cdk.CfnOutput(this, 'IdentityPoolId', {
      value: identityPool.ref,
      description: 'Cognito Identity Pool ID for AWS credentials',
      exportName: `${this.stackName}-IdentityPoolId`,
    });


    // ========================================================================
    // AMPLIFY FRONTEND DEPLOYMENT
    // ========================================================================

    const githubToken = process.env.GITHUB_TOKEN;
    const githubOwner = process.env.GITHUB_OWNER;
    const githubRepo = process.env.GITHUB_REPO;
    // Optional: Only throw if you intend to deploy Amplify. 
    // For now, we'll check if they are present before creating Amplify resources.
    //make amplify updates

    if (githubToken && githubOwner && githubRepo) {
      const githubTokenSecret = new secretsmanager.Secret(this, 'GitHubToken', {
        secretName: 'github-secret-token-ymca',
        description: 'GitHub Personal Access Token for Amplify',
        secretStringValue: cdk.SecretValue.unsafePlainText(githubToken),
      });

      // Create service role for Amplify with DynamoDB permissions
      const amplifyServiceRole = new iam.Role(this, 'AmplifyServiceRole', {
        assumedBy: new iam.ServicePrincipal('amplify.amazonaws.com'),
        description: 'Service role for Amplify app with DynamoDB access',
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess-Amplify'),
        ],
      });

      // Grant DynamoDB permissions to Amplify service role
      conversationTable.grantReadData(amplifyServiceRole);
      analyticsTable.grantReadData(amplifyServiceRole);

      const amplifyApp = new amplifyAlpha.App(this, 'YmcaAmplifyAppV2', {
        sourceCodeProvider: new amplifyAlpha.GitHubSourceCodeProvider({
          owner: githubOwner,
          repository: githubRepo,
          oauthToken: githubTokenSecret.secretValue,
        }),
        platform: amplifyAlpha.Platform.WEB,
        role: amplifyServiceRole,
        // No custom rules needed - Next.js static export handles routing
      });

      const mainBranch = amplifyApp.addBranch('main', {
        autoBuild: true,
        stage: 'PRODUCTION',
      });

      // Inject Environment Variables into Amplify
      mainBranch.addEnvironment('NEXT_PUBLIC_STREAMING_ENDPOINT', streamingFunctionUrl.url);
      mainBranch.addEnvironment('NEXT_PUBLIC_USER_POOL_ID', userPool.userPoolId);
      mainBranch.addEnvironment('NEXT_PUBLIC_USER_POOL_CLIENT_ID', userPoolClient.userPoolClientId);
      mainBranch.addEnvironment('NEXT_PUBLIC_IDENTITY_POOL_ID', identityPool.ref);
      mainBranch.addEnvironment('NEXT_PUBLIC_REGION', this.region);
      mainBranch.addEnvironment('NEXT_PUBLIC_AWS_REGION', this.region);
      mainBranch.addEnvironment('NEXT_PUBLIC_ANALYTICS_TABLE_NAME', analyticsTable.tableName);
      mainBranch.addEnvironment('NEXT_PUBLIC_CONVERSATION_TABLE_NAME', conversationTable.tableName);
      mainBranch.addEnvironment('NEXT_PUBLIC_DOCUMENTS_BUCKET', documentsBucket.bucketName);

      githubTokenSecret.grantRead(amplifyApp);

      // Trigger build on deployment
      new AwsCustomResource(this, 'TriggerAmplifyBuild', {
        onCreate: {
          service: 'Amplify',
          action: 'startJob',
          parameters: {
            appId: amplifyApp.appId,
            branchName: mainBranch.branchName,
            jobType: 'RELEASE',
          },
          physicalResourceId: PhysicalResourceId.of(`${amplifyApp.appId}-${mainBranch.branchName}-${Date.now()}`),
        },
        onUpdate: {
          service: 'Amplify',
          action: 'startJob',
          parameters: {
            appId: amplifyApp.appId,
            branchName: mainBranch.branchName,
            jobType: 'RELEASE',
          },
          physicalResourceId: PhysicalResourceId.of(`${amplifyApp.appId}-${mainBranch.branchName}-${Date.now()}`),
        },
        policy: AwsCustomResourcePolicy.fromSdkCalls({
          resources: [
            `arn:aws:amplify:${this.region}:${this.account}:apps/${amplifyApp.appId}`,
            `arn:aws:amplify:${this.region}:${this.account}:apps/${amplifyApp.appId}/branches/${mainBranch.branchName}/jobs/*`,
          ],
        }),
      });

      new cdk.CfnOutput(this, 'AmplifyAppUrl', {
        value: `https://main.${amplifyApp.defaultDomain}`,
        description: 'Amplify App URL',
      });
    }

    //     new cdk.CfnOutput(this, 'PostDeploymentInstructions', {
    //       value: `

    // 2. Admin User Setup:
    //    - Go to AWS Console > Cognito > User pools > ymca-admin-user-pool
    //    - Create a new user (email/password)
    //    - Mark email as verified
    //    - This user will be able to access the Admin Dashboard

    // 3. GitHub Configuration (for Amplify):
    //    - Ensure GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO are set in backend/.env
    //    - GITHUB_TOKEN must be a Personal Access Token with 'repo' and 'admin:repo_hook' scopes
    //       `,
    //       description: 'Post-deployment setup instructions',
    //     });

    // ========================================================================
    // CDK NAG SUPPRESSIONS
    // Suppressions are applied where AWS service limitations or third-party
    // constructs prevent full compliance. Each suppression includes justification.
    // ========================================================================

    // AWSLambdaBasicExecutionRole is the minimal managed policy for Lambda logging.
    // CDK-managed constructs (cdk-s3-vectors, BucketNotifications, custom resources)
    // use it internally and cannot be replaced with inline policies.
    const lambdaBasicExecSuppression = {
      id: 'AwsSolutions-IAM4',
      reason: 'AWSLambdaBasicExecutionRole is the minimal policy for Lambda CloudWatch logging. Used by CDK-managed constructs (cdk-s3-vectors, BucketNotifications, AwsCustomResource) that cannot be customized.',
      appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
    };

    NagSuppressions.addResourceSuppressions(lambdaExecutionRole, [lambdaBasicExecSuppression]);
    NagSuppressions.addResourceSuppressions(batchProcessorRole, [lambdaBasicExecSuppression]);

    // Wildcard on documentsBucket/* is intentional - Lambda needs access to all objects in the bucket
    NagSuppressions.addResourceSuppressions(lambdaExecutionRole, [
      { id: 'AwsSolutions-IAM5', reason: 'Lambda requires access to all objects in the documents bucket for read/write operations across input/ and output/ prefixes.', appliesTo: [`Resource::<YmcaDocumentsBucket28FD4479.Arn>/*`] },
      { id: 'AwsSolutions-IAM5', reason: 'Textract does not support resource-level ARNs. AWS limitation documented at https://docs.aws.amazon.com/textract/latest/dg/security_iam_service-with-iam.html', appliesTo: ['Resource::*'] },
      { id: 'AwsSolutions-IAM5', reason: 'Bedrock knowledge-base/* wildcard is required as the knowledge base ID is only known at runtime.', appliesTo: [`Resource::arn:aws:bedrock:<AWS::Region>:<AWS::AccountId>:knowledge-base/*`] },
    ]);

    NagSuppressions.addResourceSuppressions(batchProcessorRole, [
      { id: 'AwsSolutions-IAM5', reason: 'Lambda requires access to all objects in the documents bucket.', appliesTo: [`Resource::<YmcaDocumentsBucket28FD4479.Arn>/*`] },
    ]);

    // knowledgeBaseRole: s3vectors resources: ['*'] - ARN format not yet documented by AWS
    NagSuppressions.addResourceSuppressions(knowledgeBaseRole, [
      { id: 'AwsSolutions-IAM5', reason: 'S3 Vectors is a new service and resource-level ARN scoping is not yet documented. Will tighten when ARN format is published.', appliesTo: ['Resource::*'] },
      { id: 'AwsSolutions-IAM5', reason: 'documentsBucket.grantRead() generates s3:GetObject* and s3:List* wildcards. These are scoped to the specific documents bucket.', appliesTo: ['Action::s3:GetBucket*', 'Action::s3:GetObject*', 'Action::s3:List*', `Resource::<YmcaDocumentsBucket28FD4479.Arn>/*`] },
    ], true);

    // Authenticated role: s3:Abort* is added by grantPut() - scoped to input/* prefix
    NagSuppressions.addResourceSuppressions(authenticatedRole, [
      { id: 'AwsSolutions-IAM5', reason: 'grantPut() adds s3:Abort* for multipart upload cleanup. Scoped to input/* prefix only.', appliesTo: ['Action::s3:Abort*', `Resource::<YmcaDocumentsBucket28FD4479.Arn>/input/*`] },
    ], true);

    // Step Functions role: Lambda ARN:* wildcards are added by CDK grantInvoke() for versioning support
    NagSuppressions.addResourceSuppressionsByPath(this, '/YmcaAiStack/YmcaDocumentProcessingWorkflow/Role/DefaultPolicy/Resource', [
      { id: 'AwsSolutions-IAM5', reason: 'CDK grantInvoke() appends :* to Lambda ARNs to support Lambda versions/aliases. This is CDK-managed behavior.' },
    ]);

    // NODEJS_20_X is the current LTS runtime. NODEJS_22_X is available but not yet LTS.
    // All our Lambda functions use NODEJS_20_X intentionally.
    const lambdaRuntimeSuppression = { id: 'AwsSolutions-L1', reason: 'NODEJS_20_X is the current LTS runtime. NODEJS_22_X is available but not yet LTS-stable for production workloads.' };
    NagSuppressions.addResourceSuppressions(agentProxyStreamingFunction, [lambdaRuntimeSuppression]);
    NagSuppressions.addResourceSuppressions(batchProcessorFunction, [lambdaRuntimeSuppression]);
    NagSuppressions.addResourceSuppressions(textractAsyncFunction, [lambdaRuntimeSuppression]);
    NagSuppressions.addResourceSuppressions(textractPostprocessorFunction, [lambdaRuntimeSuppression]);
    NagSuppressions.addResourceSuppressions(checkTextractStatusFunction, [lambdaRuntimeSuppression]);

    // cdk-s3-vectors and BucketNotifications are third-party/CDK-managed constructs.
    // We cannot control their internal Lambda runtime or IAM policies.
    NagSuppressions.addResourceSuppressionsByPath(this, '/YmcaAiStack/YmcaVectorsBucket', [
      lambdaRuntimeSuppression,
      lambdaBasicExecSuppression,
      { id: 'AwsSolutions-IAM5', reason: 'cdk-s3-vectors internal construct. Cannot customize IAM policies of third-party constructs.' },
    ], true);
    NagSuppressions.addResourceSuppressionsByPath(this, '/YmcaAiStack/YmcaVectorIndex', [
      lambdaRuntimeSuppression,
      lambdaBasicExecSuppression,
      { id: 'AwsSolutions-IAM5', reason: 'cdk-s3-vectors internal construct. Cannot customize IAM policies of third-party constructs.' },
    ], true);
    NagSuppressions.addResourceSuppressionsByPath(this, '/YmcaAiStack/BucketNotificationsHandler050a0587b7544547bf325f094a3db834', [
      lambdaBasicExecSuppression,
    ], true);

    // GitHub token secret: PATs cannot be auto-rotated via Secrets Manager rotation lambdas.
    // Token rotation is handled manually when GitHub PAT expires.
    NagSuppressions.addResourceSuppressionsByPath(this, '/YmcaAiStack/GitHubToken/Resource', [
      { id: 'AwsSolutions-SMG4', reason: 'GitHub Personal Access Token cannot be auto-rotated via Secrets Manager. Token is rotated manually when it expires.' },
    ]);

    // AdministratorAccess-Amplify is the AWS-recommended service role for Amplify.
    // It is scoped to Amplify service operations only.
    NagSuppressions.addResourceSuppressionsByPath(this, '/YmcaAiStack/AmplifyServiceRole/Resource', [
      { id: 'AwsSolutions-IAM4', reason: 'AdministratorAccess-Amplify is the AWS-recommended managed policy for Amplify service roles. It is assumed only by amplify.amazonaws.com.', appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/AdministratorAccess-Amplify'] },
    ]);

    // TriggerAmplifyBuild custom resource: jobs/* wildcard is required as job IDs are generated at runtime
    NagSuppressions.addResourceSuppressionsByPath(this, '/YmcaAiStack/TriggerAmplifyBuild/CustomResourcePolicy/Resource', [
      { id: 'AwsSolutions-IAM5', reason: 'Amplify job IDs are generated at runtime and cannot be predicted. The wildcard is scoped to a specific app and branch.' },
    ]);

    // AwsCustomResource provider Lambda (AWS679f...) is CDK-managed
    NagSuppressions.addResourceSuppressionsByPath(this, '/YmcaAiStack/AWS679f53fac002430cb0da5b7982bd2287', [
      lambdaRuntimeSuppression,
      lambdaBasicExecSuppression,
    ], true);

    // MFA is a warning (not error) - noted for future consideration
    // COG2 (MFA) suppressed: admin-only user pool with strong password policy
    // COG3 (AdvancedSecurityMode) suppressed: requires Cognito PLUS tier (paid), not available on ESSENTIALS
    NagSuppressions.addResourceSuppressions(userPool, [
      { id: 'AwsSolutions-COG2', reason: 'Admin-only user pool with strong password policy. MFA will be added in a future iteration.' },
      { id: 'AwsSolutions-COG3', reason: 'AdvancedSecurityMode ENFORCED requires Cognito PLUS pricing tier. Currently on ESSENTIALS (free) tier. Will upgrade for production.' },
    ]);

    // DynamoDB PITR warnings - noted, will enable for production
    NagSuppressions.addResourceSuppressions(conversationTable, [
      { id: 'AwsSolutions-DDB3', reason: 'PITR will be enabled for production. Currently in development phase.' },
    ]);
    NagSuppressions.addResourceSuppressions(analyticsTable, [
      { id: 'AwsSolutions-DDB3', reason: 'PITR will be enabled for production. Currently in development phase.' },
    ]);
  }

  private createDocumentProcessingWorkflow(
    textractAsync: lambda.Function,
    textractPostprocessor: lambda.Function,
    checkStatusFunction: lambda.Function
  ): stepfunctions.StateMachine {

    // Define Step Functions tasks
    const startTextractTask = new stepfunctionsTasks.LambdaInvoke(this, 'StartTextractTask', {
      lambdaFunction: textractAsync,
      outputPath: '$.Payload',
    });

    // Wait state for Textract async processing - longer wait for large documents
    const waitForTextract = new stepfunctions.Wait(this, 'WaitForTextract', {
      time: stepfunctions.WaitTime.duration(cdk.Duration.seconds(120)), // 2 minutes between checks
    });

    // Check Textract job status using external function
    const checkTextractStatus = new stepfunctionsTasks.LambdaInvoke(this, 'CheckTextractStatus', {
      lambdaFunction: checkStatusFunction,
      outputPath: '$.Payload',
    });

    // Process Textract results
    const processTextractResults = new stepfunctionsTasks.LambdaInvoke(this, 'ProcessTextractResults', {
      lambdaFunction: textractPostprocessor,
      outputPath: '$.Payload',
    });

    // Success state
    const processingComplete = new stepfunctions.Succeed(this, 'ProcessingComplete', {
      comment: 'Document processing completed successfully',
    });

    // Failure state
    const processingFailed = new stepfunctions.Fail(this, 'ProcessingFailed', {
      comment: 'Document processing failed',
    });

    // Define the workflow with proper status checking and loop protection
    const definition = startTextractTask
      .next(waitForTextract)
      .next(checkTextractStatus)
      .next(new stepfunctions.Choice(this, 'IsTextractComplete')
        .when(
          stepfunctions.Condition.stringEquals('$.status', 'SUCCEEDED'),
          processTextractResults.next(processingComplete)
        )
        .when(
          stepfunctions.Condition.stringEquals('$.status', 'FAILED'),
          processingFailed
        )
        .when(
          stepfunctions.Condition.stringEquals('$.status', 'PARTIAL_SUCCESS'),
          processingFailed
        )
        .otherwise(waitForTextract) // Continue waiting if IN_PROGRESS
      );

    // Create the state machine with extended timeout for large documents
    const stateMachine = new stepfunctions.StateMachine(this, 'YmcaDocumentProcessingWorkflow', {
      stateMachineName: 'ymca-document-processing',
      definitionBody: stepfunctions.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.hours(2), // 2 hours for very large documents
      tracingEnabled: true, // AwsSolutions-SF2: enable X-Ray tracing
      logs: {
        destination: new logs.LogGroup(this, 'YmcaStateMachineLogs', {
          logGroupName: '/aws/states/ymca-document-processing',
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
        level: stepfunctions.LogLevel.ALL, // AwsSolutions-SF1: log ALL events
        includeExecutionData: false,
      },
    });

    return stateMachine;
  }
}