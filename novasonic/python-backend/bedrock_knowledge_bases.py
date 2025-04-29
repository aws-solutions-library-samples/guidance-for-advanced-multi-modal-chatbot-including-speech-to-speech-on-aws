import os
import boto3
import json
import logging

# Configure logging
logger = logging.getLogger(__name__)

def retrieve_kb(query, max_results=3):
    """
    Retrieve information from a Bedrock Knowledge Base
    
    Args:
        query (str): The query to search for
        max_results (int): Maximum number of results to return
        
    Returns:
        str: The retrieved information or an error message
    """
    try:
        # Get the Knowledge Base ID from environment variable
        kb_id = os.environ.get('REACT_APP_DOCUMENTS_KB_ID')
        if not kb_id:
            logger.warning("REACT_APP_DOCUMENTS_KB_ID environment variable not set")
            return "Knowledge Base ID not configured"
        
        # Get the region from environment variable or use default
        region = os.environ.get('REACT_APP_AWS_REGION', 'us-east-1')
        
        # Create a Bedrock client
        bedrock_client = boto3.client(
            service_name='bedrock-agent-runtime',
            region_name=region
        )
        
        # Call the Retrieve API
        response = bedrock_client.retrieve(
            knowledgeBaseId=kb_id,
            retrievalQuery={
                'text': query
            },
            retrievalConfiguration={
                'vectorSearchConfiguration': {
                    'numberOfResults': max_results
                }
            }
        )
        
        # Process the response
        results = []
        for result in response.get('retrievalResults', []):
            content = result.get('content', {}).get('text', '')
            source = result.get('location', {}).get('s3Location', {}).get('uri', 'Unknown source')
            score = result.get('score', 0)
            
            results.append({
                'content': content,
                'source': source,
                'score': score
            })
        
        # Format the results
        if results:
            formatted_results = []
            for i, result in enumerate(results, 1):
                formatted_results.append(f"Result {i}:\n{result['content']}\nSource: {result['source']}\nRelevance: {result['score']:.2f}\n")
            
            return "\n".join(formatted_results)
        else:
            return "No results found for your query."
            
    except Exception as e:
        logger.error(f"Error retrieving from Knowledge Base: {str(e)}")
        return f"Error retrieving information: {str(e)}"

def retrieve_and_generation(query):
    """
    Retrieve information from a Knowledge Base and generate a response using RAG
    
    Args:
        query (str): The query to search for
        
    Returns:
        str: The generated response based on retrieved information
    """
    try:
        # Get the Knowledge Base ID from environment variable
        kb_id = os.environ.get('REACT_APP_DOCUMENTS_KB_ID')
        if not kb_id:
            logger.warning("REACT_APP_DOCUMENTS_KB_ID environment variable not set")
            return "Knowledge Base ID not configured"
        
        # Get the region from environment variable or use default
        region = os.environ.get('REACT_APP_AWS_REGION', 'us-east-1')
        
        # Get the model ARN from environment variable or use default
        model_arn = os.environ.get('RAG_MODEL_ARN', 'anthropic.claude-3-haiku-20240307-v1:0')
        
        # Create a Bedrock client
        bedrock_agent_runtime = boto3.client('bedrock-agent-runtime', region_name=region)
        
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
        
        # Call the RetrieveAndGenerate API
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
                            'numberOfResults': 3  # Number of documents to retrieve
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
        
        # Process the response
        results = []
        if "citations" in response:
            for r in response["citations"]:
                results.append(r["generatedResponsePart"]["textResponsePart"]["text"])
        
        # Return the generated response
        if results:
            return " ".join(results)
        else:
            return "No response could be generated for your query."
            
    except Exception as e:
        logger.error(f"Error in retrieve_and_generation: {str(e)}")
        return f"Error generating response: {str(e)}"
