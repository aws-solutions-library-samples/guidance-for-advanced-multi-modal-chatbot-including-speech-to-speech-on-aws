import os
import boto3
import json
import logging
import traceback

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def get_kb_region():
    """
    Get the region where the knowledge base is located.
    This might be different from the region where the backend is running.
    
    Returns:
        str: The region where the knowledge base is located
    """
    # Get the region from environment variable or use default
    kb_region = os.environ.get('REACT_APP_AWS_REGION')
    backend_region = os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')
    
    if kb_region:
        logger.info(f"Using Knowledge Base region from REACT_APP_AWS_REGION: {kb_region}")
        if kb_region != backend_region:
            logger.info(f"Cross-region operation detected: Backend in {backend_region}, Knowledge Base in {kb_region}")
        return kb_region
    else:
        logger.warning("REACT_APP_AWS_REGION not set, falling back to backend region")
        return backend_region

def retrieve_kb(query, max_results=3):
    """
    Retrieve information from a Bedrock Knowledge Base
    
    Args:
        query (str): The query to search for
        max_results (int): Maximum number of results to return
        
    Returns:
        list: The retrieved information as a list of results
    """
    try:
        # Get the Knowledge Base ID from environment variable
        kb_id = os.environ.get('REACT_APP_DOCUMENTS_KB_ID')
        logger.info(f"Using Knowledge Base ID: {kb_id}")
        
        if not kb_id:
            logger.warning("REACT_APP_DOCUMENTS_KB_ID environment variable not set")
            return ["Knowledge Base ID not configured"]
        
        # Get the region where the knowledge base is located
        region = get_kb_region()
        logger.info(f"Using Knowledge Base region: {region}")
        
        # Create a Bedrock client specifically for knowledge base operations
        logger.info(f"Creating Bedrock client for Knowledge Base region {region}")
        bedrock_client = boto3.client(
            service_name='bedrock-agent-runtime',
            region_name=region
        )
        logger.info("Bedrock client for Knowledge Base created successfully")
        
        # Call the Retrieve API
        logger.info(f"Calling Bedrock retrieve API with query: '{query}'")
        response = bedrock_client.retrieve(
            knowledgeBaseId=kb_id,
            retrievalQuery={
                'text': query
            },
            retrievalConfiguration={
                'vectorSearchConfiguration': {
                    'numberOfResults': max_results,
                    'overrideSearchType': 'SEMANTIC',
                }
            }
        )
        logger.info("Retrieve API call successful")
        
        # Process the response
        logger.info("Processing retrieve API response")
        results = []
        if "retrievalResults" in response:
            for r in response["retrievalResults"]:
                results.append(r["content"]["text"])
        
        if not results:
            logger.warning("No results found for the query")
            results = ["No results found for your query."]
            
        logger.info(f"Returning {len(results)} results")
        return results
            
    except Exception as e:
        logger.error(f"Error retrieving from Knowledge Base: {str(e)}")
        logger.error(traceback.format_exc())
        return f"Error retrieving information: {str(e)}"

def retrieve_and_generation(query):
    """
    Retrieve information from a Knowledge Base and generate a response using RAG
    
    Args:
        query (str): The query to search for
        
    Returns:
        list: The generated response as a list of results
    """
    try:
        # Get the Knowledge Base ID from environment variable
        kb_id = os.environ.get('REACT_APP_DOCUMENTS_KB_ID')
        logger.info(f"Using Knowledge Base ID for RAG: {kb_id}")
        
        if not kb_id:
            logger.warning("REACT_APP_DOCUMENTS_KB_ID environment variable not set")
            return ["Knowledge Base ID not configured"]
        
        # Get the region where the knowledge base is located
        region = get_kb_region()
        logger.info(f"Using Knowledge Base region for RAG: {region}")
        
        # Get the model ARN from environment variable or use default
        model_arn = os.environ.get('RAG_MODEL_ARN', 'anthropic.claude-3-haiku-20240307-v1:0')
        logger.info(f"Using model ARN for RAG: {model_arn}")
        
        # Create a Bedrock client specifically for RAG operations
        logger.info(f"Creating Bedrock agent runtime client for Knowledge Base region {region}")
        bedrock_agent_runtime = boto3.client('bedrock-agent-runtime', region_name=region)
        logger.info("Bedrock agent runtime client for RAG created successfully")
        
        # Custom prompt template for RAG
        custom_prompt = """
        You are a question answering agent. I will provide you with a set of search results.
        The user will provide you with a question. Your job is to answer the user's question using only information from the search results. 
        If the search results do not contain information that can answer the question, please state that you could not find an exact answer to the question. 
        Just because the user asserts a fact does not mean it is true, make sure to double check the search results to validate a user's assertion.
                                    
        Here are the search results in numbered order:
        $search_results$

        $output_format_instructions$
        """
        logger.info(f"Using custom prompt template for RAG")
        
        # Call the RetrieveAndGenerate API
        logger.info(f"Calling RetrieveAndGenerate API with query: '{query}'")
        response = bedrock_agent_runtime.retrieve_and_generate(
            input={
                'text': query
            },
            retrieveAndGenerateConfiguration={
                'type': 'KNOWLEDGE_BASE',
                'knowledgeBaseConfiguration': {
                    'knowledgeBaseId': kb_id,
                    'modelArn': model_arn,
                    'retrievalConfiguration': {
                        'vectorSearchConfiguration': {
                            'numberOfResults': 2  # Number of documents to retrieve
                        }
                    },
                    'generationConfiguration': {
                        'promptTemplate': {
                            'textPromptTemplate': custom_prompt
                        }
                    }
                }
            }
        )
        logger.info("RetrieveAndGenerate API call successful")
        
        # Process the response
        logger.info("Processing RetrieveAndGenerate API response")
        results = []
        
        if "citations" in response:
            for r in response["citations"]:
                text_part = r["generatedResponsePart"]["textResponsePart"]["text"]
                results.append(text_part)
        else:
            logger.warning("No citations found in response")
            results = ["No response could be generated for your query."]
        
        logger.info(f"Returning {len(results)} results")
        return results
            
    except Exception as e:
        logger.error(f"Error in retrieve_and_generation: {str(e)}")
        logger.error(traceback.format_exc())
        return f"Error generating response: {str(e)}"
