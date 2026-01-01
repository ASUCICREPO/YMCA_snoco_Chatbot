const { SFNClient, StartExecutionCommand } = require('@aws-sdk/client-sfn');

const sfnClient = new SFNClient({});

/**
 * YMCA AI Batch Processor Lambda Function
 * Triggered by S3 events when documents are uploaded to input/ prefix
 * Starts the Step Functions document processing workflow
 */
exports.handler = async (event) => {
  console.log('Batch Processor Lambda - Event:', JSON.stringify(event, null, 2));
  
  try {
    // Extract S3 event details
    const s3Event = event.Records?.[0]?.s3;
    if (!s3Event) {
      throw new Error('No S3 event found');
    }

    const bucketName = s3Event.bucket.name;
    const objectKey = decodeURIComponent(s3Event.object.key.replace(/\+/g, ' '));
    
    console.log(`Processing document: ${objectKey} from bucket: ${bucketName}`);

    // Validate file type (PDF, images, etc.)
    const supportedExtensions = ['.pdf', '.png', '.jpg', '.jpeg', '.tiff', '.tif'];
    const fileExtension = objectKey.toLowerCase().substring(objectKey.lastIndexOf('.'));
    
    if (!supportedExtensions.includes(fileExtension)) {
      console.log(`Skipping unsupported file type: ${fileExtension}`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'File type not supported for processing',
          fileType: fileExtension,
          supportedTypes: supportedExtensions
        })
      };
    }

    // Start Step Functions execution
    const stepFunctionInput = {
      bucketName,
      objectKey,
      timestamp: new Date().toISOString(),
      fileExtension,
      processingId: `doc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };

    // Generate execution name (must be unique and follow AWS naming rules)
    const executionName = `doc-processing-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

    const command = new StartExecutionCommand({
      stateMachineArn: process.env.STEP_FUNCTION_ARN,
      input: JSON.stringify(stepFunctionInput),
      name: executionName
    });

    const result = await sfnClient.send(command);
    console.log('Step Functions execution started:', result.executionArn);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Document processing workflow started successfully',
        executionArn: result.executionArn,
        document: objectKey,
        processingId: stepFunctionInput.processingId
      })
    };
  } catch (error) {
    console.error('Error starting document processing:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Failed to start document processing',
        error: error.message
      })
    };
  }
};