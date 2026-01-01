const { TextractClient, GetDocumentTextDetectionCommand, GetDocumentAnalysisCommand } = require('@aws-sdk/client-textract');

const textractClient = new TextractClient({});

/**
 * YMCA AI Check Textract Status Lambda Function
 * Checks the status of asynchronous Textract jobs
 * Used by Step Functions to monitor job completion
 */
exports.handler = async (event) => {
  console.log('Check Status Lambda - Event:', JSON.stringify(event, null, 2));
  
  try {
    const { jobId, operationType } = event;
    
    if (!jobId) {
      throw new Error('Missing jobId in event');
    }

    console.log(`Checking status for Textract job: ${jobId} (${operationType})`);

    // Choose the appropriate command based on operation type
    let command;
    if (operationType === 'ANALYSIS') {
      command = new GetDocumentAnalysisCommand({ JobId: jobId });
    } else {
      command = new GetDocumentTextDetectionCommand({ JobId: jobId });
    }

    const result = await textractClient.send(command);
    console.log(`Textract job ${jobId} status: ${result.JobStatus}`);

    // Return the event with updated status information
    return {
      ...event,
      status: result.JobStatus,
      jobStatus: result.JobStatus,
      statusMessage: result.StatusMessage || 'No status message',
      nextToken: result.NextToken || null
    };
  } catch (error) {
    console.error('Error checking Textract status:', error);
    
    // Return failed status with error details
    return {
      ...event,
      status: 'FAILED',
      jobStatus: 'FAILED',
      error: error.message,
      statusMessage: `Error checking job status: ${error.message}`
    };
  }
};