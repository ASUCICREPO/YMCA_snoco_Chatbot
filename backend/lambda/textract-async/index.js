const { TextractClient, StartDocumentTextDetectionCommand, StartDocumentAnalysisCommand } = require('@aws-sdk/client-textract');

const textractClient = new TextractClient({});

/**
 * YMCA AI Textract Async Lambda Function
 * Starts asynchronous Textract jobs for document text extraction
 * Supports both text detection and document analysis
 */
exports.handler = async (event) => {
  console.log('Textract Async Lambda - Event:', JSON.stringify(event, null, 2));
  
  try {
    const { bucketName, objectKey, fileExtension, processingId } = event;
    
    if (!bucketName || !objectKey) {
      throw new Error('Missing bucketName or objectKey in event');
    }

    console.log(`Starting Textract job for: ${objectKey} (${fileExtension})`);

    // Determine Textract operation based on file type and requirements
    // For YMCA documents, we'll use StartDocumentTextDetection for basic text extraction
    // Could be enhanced to use StartDocumentAnalysis for forms/tables if needed
    
    const outputConfig = {
      S3Bucket: bucketName,
      S3Prefix: `output/textract-results/${processingId}/`
    };

    let command;
    let operationType;

    // For PDFs and complex documents, use document analysis to get better structure
    if (fileExtension === '.pdf') {
      command = new StartDocumentAnalysisCommand({
        DocumentLocation: {
          S3Object: {
            Bucket: bucketName,
            Name: objectKey
          }
        },
        FeatureTypes: ['TABLES', 'FORMS'], // Extract tables and forms in addition to text
        OutputConfig: outputConfig,
        JobTag: `ymca-analysis-${processingId}`
      });
      operationType = 'ANALYSIS';
    } else {
      // For images, use text detection
      command = new StartDocumentTextDetectionCommand({
        DocumentLocation: {
          S3Object: {
            Bucket: bucketName,
            Name: objectKey
          }
        },
        OutputConfig: outputConfig,
        JobTag: `ymca-detection-${processingId}`
      });
      operationType = 'TEXT_DETECTION';
    }

    const result = await textractClient.send(command);
    console.log(`Textract ${operationType} job started:`, result.JobId);

    return {
      statusCode: 200,
      jobId: result.JobId,
      bucketName,
      objectKey,
      processingId,
      operationType,
      status: 'IN_PROGRESS',
      outputLocation: `s3://${bucketName}/${outputConfig.S3Prefix}`
    };
  } catch (error) {
    console.error('Error starting Textract job:', error);
    return {
      statusCode: 500,
      error: error.message,
      status: 'FAILED',
      bucketName: event.bucketName,
      objectKey: event.objectKey,
      processingId: event.processingId
    };
  }
};