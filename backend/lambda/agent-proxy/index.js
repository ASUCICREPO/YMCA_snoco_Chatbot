const { BedrockAgentRuntimeClient, RetrieveAndGenerateCommand } = require('@aws-sdk/client-bedrock-agent-runtime');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { TranslateClient, TranslateTextCommand, DetectDominantLanguageCommand } = require('@aws-sdk/client-translate');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

// Initialize AWS clients
const bedrockAgentClient = new BedrockAgentRuntimeClient({ region: process.env.REGION || 'us-west-2' });
const bedrockRuntimeClient = new BedrockRuntimeClient({ region: process.env.REGION || 'us-west-2' });
const translateClient = new TranslateClient({ region: process.env.REGION || 'us-west-2' });
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.REGION || 'us-west-2' }));

// Configuration
const KNOWLEDGE_BASE_ID = process.env.KNOWLEDGE_BASE_ID;
const CONVERSATION_TABLE = process.env.CONVERSATION_TABLE_NAME;
const ANALYTICS_TABLE = process.env.ANALYTICS_TABLE_NAME;

// Supported languages for YMCA multilingual support
const SUPPORTED_LANGUAGES = {
  'en': 'English',
  'es': 'Spanish', 
  'fr': 'French',
  'de': 'German',
  'it': 'Italian',
  'pt': 'Portuguese',
  'zh': 'Chinese',
  'ja': 'Japanese',
  'ko': 'Korean',
  'ar': 'Arabic',
  'hi': 'Hindi',
  'ru': 'Russian'
};

exports.handler = async (event) => {
  console.log('YMCA AI Agent Proxy - Event:', JSON.stringify(event, null, 2));
  
  try {
    // Parse request body
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const { 
      message, 
      conversationId, 
      language = 'auto',
      sessionId = generateSessionId(),
      userId = 'anonymous'
    } = body;

    if (!message) {
      return createResponse(400, { error: 'Message is required' });
    }

    // Generate unique query ID for analytics
    const queryId = generateQueryId();
    const timestamp = Date.now();

    // Step 1: Detect language if auto-detection is enabled
    let detectedLanguage = 'en';
    let originalLanguage = 'en';
    
    if (language === 'auto') {
      try {
        const detectCommand = new DetectDominantLanguageCommand({
          Text: message
        });
        const detectResult = await translateClient.send(detectCommand);
        
        if (detectResult.Languages && detectResult.Languages.length > 0) {
          detectedLanguage = detectResult.Languages[0].LanguageCode;
          originalLanguage = detectedLanguage;
        }
      } catch (error) {
        console.warn('Language detection failed, defaulting to English:', error);
      }
    } else {
      detectedLanguage = language;
      originalLanguage = language;
    }

    console.log(`Detected language: ${detectedLanguage} (${SUPPORTED_LANGUAGES[detectedLanguage] || 'Unknown'})`);

    // Step 2: Translate query to English if needed (for better RAG performance)
    let queryInEnglish = message;
    if (detectedLanguage !== 'en') {
      try {
        const translateCommand = new TranslateTextCommand({
          Text: message,
          SourceLanguageCode: detectedLanguage,
          TargetLanguageCode: 'en'
        });
        const translateResult = await translateClient.send(translateCommand);
        queryInEnglish = translateResult.TranslatedText;
        console.log(`Translated query to English: ${queryInEnglish}`);
      } catch (error) {
        console.warn('Translation to English failed, using original query:', error);
      }
    }

    // Step 3: Perform RAG query using Bedrock Knowledge Base with enhanced prompting
    const ragStartTime = Date.now();
    let ragResponse;
    let citations = [];
    
    try {
      const retrieveCommand = new RetrieveAndGenerateCommand({
        input: {
          text: queryInEnglish
        },
        retrieveAndGenerateConfiguration: {
          type: 'KNOWLEDGE_BASE',
          knowledgeBaseConfiguration: {
            knowledgeBaseId: KNOWLEDGE_BASE_ID,
            modelArn: 'arn:aws:bedrock:' + (process.env.REGION || 'us-west-2') + '::foundation-model/amazon.nova-pro-v1:0',
            generationConfiguration: {
              promptTemplate: {
                textPromptTemplate: `You are a knowledgeable YMCA historian and storyteller with deep expertise in YMCA history, programs, and community impact. Your role is to transform archival materials into engaging, accessible narratives that inspire present-day reflection and decision-making.

CONTEXT: $search_results$

USER QUESTION: $query$

RESPONSE REQUIREMENTS:
1. **STORYTELLING APPROACH**: Don't just answer - tell a compelling story that brings history to life
2. **NARRATIVE STRUCTURE**: Use clear sections with engaging headings
3. **HISTORICAL CONTEXT**: Provide rich background and connect events to broader themes
4. **HUMAN ELEMENTS**: Include specific people, dates, locations, and personal stories when available
5. **MODERN RELEVANCE**: Connect historical insights to present-day YMCA work and community needs
6. **OPINIONATED INSIGHTS**: Provide thoughtful synthesis and lessons learned, not just facts

RESPONSE FORMAT (JSON):
{
  "story": {
    "title": "Engaging title that captures the essence",
    "narrative": "Rich, storytelling response with multiple paragraphs",
    "timeline": "Key dates and periods (e.g., '1918-1920')",
    "locations": "Relevant places mentioned",
    "keyPeople": "Important individuals and their roles",
    "whyItMatters": "Modern relevance and lessons for today"
  },
  "lessonsAndThemes": [
    "Key insight or lesson from this historical moment",
    "Another important theme or pattern"
  ],
  "modernReflection": "How this historical moment teaches us about today's challenges and opportunities",
  "suggestedFollowUps": [
    "What other programs did the YMCA support during this period?",
    "How does this compare to YMCA's response to other crises?"
  ]
}

TONE: Engaging, authoritative, and inspiring. Write as if you're a passionate historian sharing fascinating discoveries. Use vivid language and specific details to make history come alive.

IMPORTANT: If the context doesn't contain enough information for a full story, acknowledge this and suggest what additional archives or sources might help complete the narrative.`
              }
            }
          }
        }
      });

      const ragResult = await bedrockAgentClient.send(retrieveCommand);
      
      // Extract citations from the response
      if (ragResult.citations && ragResult.citations.length > 0) {
        citations = ragResult.citations.map(citation => ({
          title: citation.generatedResponsePart?.textResponsePart?.text?.substring(0, 100) + '...' || 'YMCA Historical Document',
          source: citation.retrievedReferences?.[0]?.location?.s3Location?.uri || 'YMCA Archives',
          page: citation.retrievedReferences?.[0]?.metadata?.page || 'N/A',
          confidence: citation.retrievedReferences?.[0]?.metadata?.score || 0.8,
          excerpt: citation.retrievedReferences?.[0]?.content?.text?.substring(0, 200) + '...' || ''
        }));
      }

      // Try to parse as JSON first, fallback to text if needed
      try {
        const jsonResponse = JSON.parse(ragResult.output.text);
        ragResponse = {
          type: 'structured',
          content: jsonResponse,
          rawText: ragResult.output.text
        };
      } catch (parseError) {
        // If not valid JSON, treat as narrative text and structure it
        ragResponse = {
          type: 'narrative',
          content: {
            story: {
              title: "YMCA Historical Insights",
              narrative: ragResult.output.text,
              timeline: "Historical period",
              locations: "Various YMCA locations",
              keyPeople: "YMCA leaders and community members",
              whyItMatters: "Understanding our heritage helps guide our future mission"
            },
            lessonsAndThemes: ["Historical continuity in YMCA's mission", "Community resilience and adaptation"],
            modernReflection: "These historical insights remind us of the YMCA's enduring commitment to community service and adaptation in times of change.",
            suggestedFollowUps: [
              "What other historical periods would you like to explore?",
              "How did the YMCA adapt to other major challenges?"
            ]
          },
          rawText: ragResult.output.text
        };
      }
      
      console.log('RAG response generated successfully');
      console.log('Citations found:', citations.length);
      
    } catch (error) {
      console.error('RAG query failed:', error);
      
      // Enhanced fallback with storytelling approach
      try {
        const fallbackPrompt = `You are a YMCA historian. The user asked: "${queryInEnglish}". 
        
Please provide a thoughtful response about YMCA history and programs in a storytelling format. Structure your response as JSON with the following format:

{
  "story": {
    "title": "Response title",
    "narrative": "Your narrative response",
    "whyItMatters": "Modern relevance"
  },
  "suggestedFollowUps": ["Follow-up question 1", "Follow-up question 2"]
}

If you don't have specific historical information, acknowledge this and suggest they contact their local YMCA or archives for more detailed historical records.`;

        const invokeCommand = new InvokeModelCommand({
          modelId: 'amazon.nova-pro-v1:0',
          body: JSON.stringify({
            messages: [{
              role: 'user',
              content: [{
                type: 'text',
                text: fallbackPrompt
              }]
            }],
            max_tokens: 2000,
            temperature: 0.7
          })
        });

        const fallbackResult = await bedrockRuntimeClient.send(invokeCommand);
        const responseBody = JSON.parse(new TextDecoder().decode(fallbackResult.body));
        const fallbackText = responseBody.output.message.content[0].text;
        
        try {
          const fallbackJson = JSON.parse(fallbackText);
          ragResponse = {
            type: 'structured',
            content: fallbackJson,
            rawText: fallbackText,
            fallback: true
          };
        } catch {
          ragResponse = {
            type: 'narrative',
            content: {
              story: {
                title: "YMCA Information",
                narrative: fallbackText,
                whyItMatters: "Understanding YMCA's mission and history"
              },
              suggestedFollowUps: [
                "What specific YMCA programs interest you?",
                "Would you like to know about YMCA history in your area?"
              ]
            },
            rawText: fallbackText,
            fallback: true
          };
        }
        
        console.log('Fallback response generated');
      } catch (fallbackError) {
        console.error('Fallback also failed:', fallbackError);
        ragResponse = {
          type: 'error',
          content: {
            story: {
              title: "Technical Difficulties",
              narrative: "I apologize, but I'm experiencing technical difficulties accessing the YMCA archives at the moment. Please contact your local YMCA for assistance with historical inquiries.",
              whyItMatters: "Your questions about YMCA history are important and deserve proper attention."
            },
            suggestedFollowUps: [
              "Try asking your question again in a few minutes",
              "Contact your local YMCA directly for historical information"
            ]
          },
          rawText: "Technical error occurred"
        };
      }
    }

    const ragEndTime = Date.now();

    // Step 4: Translate response back to original language if needed
    let finalResponse = ragResponse;
    if (originalLanguage !== 'en' && SUPPORTED_LANGUAGES[originalLanguage]) {
      try {
        // For structured responses, translate the narrative parts
        if (ragResponse.type === 'structured' || ragResponse.type === 'narrative') {
          const textToTranslate = ragResponse.content.story.narrative;
          const translateResponseCommand = new TranslateTextCommand({
            Text: textToTranslate,
            SourceLanguageCode: 'en',
            TargetLanguageCode: originalLanguage
          });
          const translateResponseResult = await translateClient.send(translateResponseCommand);
          
          // Create translated version while preserving structure
          finalResponse = {
            ...ragResponse,
            content: {
              ...ragResponse.content,
              story: {
                ...ragResponse.content.story,
                narrative: translateResponseResult.TranslatedText
              }
            }
          };
        }
        console.log(`Translated response to ${originalLanguage}`);
      } catch (error) {
        console.warn('Translation of response failed, returning English response:', error);
      }
    }

    // Step 5: Store conversation in DynamoDB with enhanced metadata
    try {
      await dynamoClient.send(new PutCommand({
        TableName: CONVERSATION_TABLE,
        Item: {
          conversationId: conversationId || sessionId,
          timestamp: timestamp,
          userId: userId,
          sessionId: sessionId,
          userMessage: message,
          userLanguage: originalLanguage,
          translatedQuery: queryInEnglish,
          aiResponse: finalResponse.content,
          aiResponseType: finalResponse.type,
          originalResponse: ragResponse.rawText,
          responseLanguage: originalLanguage,
          processingTimeMs: ragEndTime - ragStartTime,
          citationsCount: citations.length,
          sources: citations
        }
      }));
    } catch (error) {
      console.error('Failed to store conversation:', error);
    }

    // Step 6: Store enhanced analytics
    try {
      await dynamoClient.send(new PutCommand({
        TableName: ANALYTICS_TABLE,
        Item: {
          queryId: queryId,
          timestamp: timestamp,
          userId: userId,
          sessionId: sessionId,
          conversationId: conversationId || sessionId,
          language: originalLanguage,
          queryLength: message.length,
          responseLength: JSON.stringify(finalResponse.content).length,
          processingTimeMs: ragEndTime - ragStartTime,
          translationUsed: originalLanguage !== 'en',
          knowledgeBaseUsed: true,
          citationsFound: citations.length,
          responseType: finalResponse.type,
          fallbackUsed: finalResponse.fallback || false,
          success: true
        }
      }));
    } catch (error) {
      console.error('Failed to store analytics:', error);
    }

    // Return enhanced response with storytelling format
    return createResponse(200, {
      response: finalResponse.content,
      responseType: finalResponse.type,
      rawResponse: finalResponse.rawText,
      sources: citations,
      conversationId: conversationId || sessionId,
      sessionId: sessionId,
      language: originalLanguage,
      processingTime: ragEndTime - ragStartTime,
      translationUsed: originalLanguage !== 'en',
      timestamp: new Date(timestamp).toISOString(),
      metadata: {
        knowledgeBaseUsed: true,
        citationsFound: citations.length,
        responseStructured: finalResponse.type === 'structured',
        fallbackUsed: finalResponse.fallback || false
      }
    });

  } catch (error) {
    console.error('Handler error:', error);
    
    // Store error analytics
    try {
      await dynamoClient.send(new PutCommand({
        TableName: ANALYTICS_TABLE,
        Item: {
          queryId: generateQueryId(),
          timestamp: Date.now(),
          userId: 'unknown',
          error: error.message,
          success: false
        }
      }));
    } catch (analyticsError) {
      console.error('Failed to store error analytics:', analyticsError);
    }

    return createResponse(500, {
      response: {
        story: {
          title: "Technical Difficulties",
          narrative: "I apologize, but I encountered an error processing your request. Please try again or contact your local YMCA for assistance.",
          whyItMatters: "Your questions about YMCA history and programs are important to us."
        },
        suggestedFollowUps: [
          "Try rephrasing your question",
          "Contact your local YMCA directly"
        ]
      },
      responseType: 'error',
      error: 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
};

// Helper functions
function createResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    },
    body: JSON.stringify(body)
  };
}

function generateSessionId() {
  return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function generateQueryId() {
  return 'query_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}