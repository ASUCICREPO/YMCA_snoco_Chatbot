# YMCA AI Backend Infrastructure

AWS CDK infrastructure for the YMCA AI multilingual chatbot.

---

## Architecture Overview

Serverless architecture on AWS:

- **S3 Buckets**: Documents (`input/` uploads, `output/processed-text/` Textract output), S3 Vectors (embeddings), Access Logs
- **Lambda Function URLs**: Streaming chat (`RESPONSE_STREAM`, 15-min timeout), document processing pipeline
- **Step Functions**: Textract OCR orchestration with X-Ray tracing + CloudWatch logging
- **Bedrock Knowledge Base**: RAG retrieval backed by S3 Vectors + Titan Embeddings V2
- **DynamoDB**: `ymca-conversations` and `ymca-analytics` tables
- **Cognito**: User Pool (self sign-up disabled) + Identity Pool for admin dashboard AWS credentials
- **Amplify**: Frontend hosting with automatic env var injection from CDK outputs

---

## Prerequisites

- AWS CLI configured (`aws configure`)
- Node.js 18+
- AWS CDK CLI (`npm install -g aws-cdk`)

---

## Quick Start

```bash
npm install
npm run build
npm run deploy
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript |
| `npm run watch` | Watch + recompile |
| `npm run test` | Run unit tests |
| `npm run deploy` | Deploy CDK stack |
| `npm run destroy` | Destroy stack (caution) |
| `npm run diff` | Show pending changes |
| `npm run synth` | Synthesize CloudFormation template |
| `npm run bootstrap` | Bootstrap CDK in account/region |

---

## Security

### CDK Nag

[CDK Nag](https://github.com/cdklabs/cdk-nag) (`AwsSolutionsChecks`) runs automatically on every `cdk synth` via `backend/bin/backend.ts`:

```typescript
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
```

All findings are either fixed or suppressed with documented justifications in `backend-stack.ts`. The suppressed rules and their reasons are:

| Rule | Resource | Reason |
|------|----------|--------|
| `AwsSolutions-IAM4` | `lambdaExecutionRole`, `batchProcessorRole` | `AWSLambdaBasicExecutionRole` is the minimal policy for Lambda CloudWatch logging |
| `AwsSolutions-IAM4` | `AmplifyServiceRole` | `AdministratorAccess-Amplify` is the AWS-recommended managed policy for Amplify service roles |
| `AwsSolutions-IAM4` | CDK-managed constructs (cdk-s3-vectors, BucketNotifications, AwsCustomResource provider) | Internal Lambda functions created by CDK/third-party constructs; cannot be customized |
| `AwsSolutions-IAM5` | `lambdaExecutionRole` | Bucket object wildcard (`/*`) for documents bucket; Textract/Translate/Comprehend require `resources: ['*']` (AWS limitation); knowledge-base `/*` wildcard (ID only known at runtime) |
| `AwsSolutions-IAM5` | `batchProcessorRole` | Bucket object wildcard (`/*`) for documents bucket |
| `AwsSolutions-IAM5` | `knowledgeBaseRole` | S3 Vectors `resources: ['*']` — ARN format not yet documented by AWS; `grantRead()` generates `s3:GetObject*` and `s3:List*` wildcards scoped to documents bucket |
| `AwsSolutions-IAM5` | `authenticatedRole` | `grantPut()` adds `s3:Abort*` for multipart upload cleanup; scoped to `input/*` prefix only |
| `AwsSolutions-IAM5` | Step Functions role | CDK `grantInvoke()` appends `:*` to Lambda ARNs to support Lambda versions/aliases |
| `AwsSolutions-IAM5` | `TriggerAmplifyBuild` custom resource | Amplify job IDs are generated at runtime; wildcard scoped to specific app and branch |
| `AwsSolutions-IAM5` | cdk-s3-vectors constructs | Third-party construct internals; cannot customize IAM policies |
| `AwsSolutions-L1` | All application Lambda functions | `NODEJS_20_X` is current LTS; `NODEJS_22_X` not yet LTS-stable for production |
| `AwsSolutions-L1` | CDK-managed Lambdas (cdk-s3-vectors, BucketNotifications, AwsCustomResource provider) | Third-party/CDK-managed; runtime cannot be customized |
| `AwsSolutions-SMG4` | GitHub token secret | GitHub PATs cannot be auto-rotated via Secrets Manager; rotated manually on expiry |
| `AwsSolutions-COG2` | Cognito User Pool | Admin-only pool with strong password policy; MFA planned for future iteration |
| `AwsSolutions-COG3` | Cognito User Pool | `AdvancedSecurityMode.ENFORCED` requires Cognito PLUS tier (paid); currently on ESSENTIALS |
| `AwsSolutions-DDB3` | Both DynamoDB tables | PITR will be enabled for production; currently in development |
| `AwsSolutions-SF1/SF2` | Step Functions | Fixed — ALL-level logging and X-Ray tracing are enabled (not suppressed) |

### IAM Least Privilege

Every role is scoped to the minimum required:

- **Lambda execution role**: S3 (documents bucket only), DynamoDB (two specific tables), Textract (`resources: ['*']` — AWS limitation), Bedrock (specific model ARNs only), Translate/Comprehend (`resources: ['*']` — AWS limitation)
- **Bedrock Knowledge Base role**: S3 Vectors specific actions, Titan Embed V2 only, documents bucket read only (no `AmazonS3ReadOnlyAccess` managed policy)
- **Batch processor role**: Separate role with only S3 read + Step Functions `StartExecution`
- **Cognito authenticated role**: DynamoDB read on both tables, S3 `PutObject` on `input/*` prefix only

### Bedrock IAM — Cross-Region Inference

The `us.amazon.nova-pro-v1:0` inference profile prefix routes requests across all three US regions. The policy explicitly allows all of them:

```
arn:aws:bedrock:<deploy-region>:<account>:inference-profile/us.amazon.nova-pro-v1:0
arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-pro-v1:0
arn:aws:bedrock:us-east-2::foundation-model/amazon.nova-pro-v1:0
arn:aws:bedrock:us-west-2::foundation-model/amazon.nova-pro-v1:0
```

`<deploy-region>` is the region the stack is deployed to (e.g. `us-west-2`). The three foundation model ARNs must cover all US regions regardless of deploy region, because the `us.` prefix can route to any of them.

If a new region appears in logs, add `arn:aws:bedrock:<region>::foundation-model/amazon.nova-pro-v1:0` to the resources list in `backend-stack.ts` and redeploy.

### S3 Security

- All buckets: `blockPublicAccess: BLOCK_ALL`, `enforceSSL: true`, `encryption: S3_MANAGED`
- Documents bucket has a dedicated **access logs bucket** (`ymca-access-logs-<account>-<region>`) with `RETAIN` policy
- CORS on documents bucket and Lambda Function URL restricted to known origins (`localhost:3000`, `localhost:3001`, Amplify URL) — not `*`

### Cognito

- `selfSignUpEnabled: false` — no public registration; all admin accounts created by AWS admins
- Strong password policy: min 8 chars, uppercase, lowercase, digit, symbol
- `accountRecovery: EMAIL_ONLY`
- `allowUnauthenticatedIdentities: false` on Identity Pool

### Step Functions

- X-Ray tracing enabled (`tracingEnabled: true`)
- CloudWatch logging at `ALL` level to `/aws/states/ymca-document-processing` (1-month retention)

### Known Gaps (Future Work)

- MFA not yet enabled on Cognito User Pool (planned)
- DynamoDB PITR not yet enabled (planned for production)
- Cognito Advanced Security Mode requires PLUS tier upgrade

---

## Managing Admin Users

Self sign-up is disabled. All admin accounts must be created via AWS CLI or Console.

```bash
USER_POOL_ID=$(jq -r '.YmcaAiStack.UserPoolId' outputs.json)

# Create user
aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username "admin@example.com" \
  --user-attributes Name=email,Value="admin@example.com" Name=email_verified,Value=true \
  --message-action SUPPRESS

# Set permanent password (skips forced-reset flow)
aws cognito-idp admin-set-user-password \
  --user-pool-id "$USER_POOL_ID" \
  --username "admin@example.com" \
  --password "SecurePassword123!" \
  --permanent
```

See [Deployment Guide: Managing Admin Users](../docs/deploymentGuide.md#managing-admin-users) for full options.

---

## Environment Configuration

`backend/.env` (created automatically by `deploy.sh`):

```bash
AWS_REGION=us-west-2
ACCOUNT_ID=123456789012
GITHUB_TOKEN=ghp_xxxx
GITHUB_OWNER=ASUCICREPO
GITHUB_REPO=YMCA_snoco_Chatbot
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=YourSecurePassword123!
```

---

## Troubleshooting

1. **CDK Bootstrap Required**: `npm run bootstrap` on first use in a region
2. **Bedrock 403 on new region**: Add the missing `arn:aws:bedrock:<region>::foundation-model/amazon.nova-pro-v1:0` to the IAM resources list in `backend-stack.ts`
3. **Amplify build collision on deploy**: CDK triggers an Amplify build; if one is already running the deploy rolls back. Wait for the build to finish and redeploy — the stack will be in `UPDATE_ROLLBACK_COMPLETE` which is a stable, redeployable state
4. **CDK Nag warnings on synth**: Warnings are expected for suppressed rules. Errors (not warnings) must be fixed before deploying

---

## Support

- [AWS CDK Docs](https://docs.aws.amazon.com/cdk/)
- [CDK Nag Rules](https://github.com/cdklabs/cdk-nag/blob/main/RULES.md)
- [Project Docs](../docs/)
