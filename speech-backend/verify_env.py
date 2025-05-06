#!/usr/bin/env python3
"""
Script to verify environment variables for the NovaSonic backend.
This script helps debug issues with environment variables by printing them out.
"""

import os
import argparse
import json
import logging
import boto3

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def main():
    parser = argparse.ArgumentParser(description='Verify environment variables for NovaSonic backend')
    parser.add_argument('--debug', action='store_true', help='Enable debug logging')
    parser.add_argument('--test-kb', action='store_true', help='Test knowledge base connection')
    parser.add_argument('--kb-id', help='Knowledge Base ID to test')
    parser.add_argument('--kb-region', help='Knowledge Base region to test')
    
    args = parser.parse_args()
    
    # Set debug level if requested
    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)
        logger.setLevel(logging.DEBUG)
    
    # Print all environment variables
    logger.info("=== Environment Variables ===")
    for key, value in sorted(os.environ.items()):
        if key.startswith('REACT_APP_') or key in ['USE_RAG', 'RAG_MODEL_ARN', 'AWS_DEFAULT_REGION', 'KB_ID']:
            logger.info(f"{key}: {value}")
    
    # Print specific environment variables
    logger.info("\n=== Knowledge Base Environment Variables ===")
    logger.info(f"REACT_APP_DOCUMENTS_KB_ID: {os.environ.get('REACT_APP_DOCUMENTS_KB_ID')}")
    logger.info(f"REACT_APP_AWS_REGION: {os.environ.get('REACT_APP_AWS_REGION')}")
    logger.info(f"USE_RAG: {os.environ.get('USE_RAG')}")
    logger.info(f"RAG_MODEL_ARN: {os.environ.get('RAG_MODEL_ARN')}")
    logger.info(f"AWS_DEFAULT_REGION: {os.environ.get('AWS_DEFAULT_REGION')}")
    
    # Test knowledge base connection if requested
    if args.test_kb:
        logger.info("\n=== Testing Knowledge Base Connection ===")
        
        # Set environment variables if provided
        if args.kb_id:
            os.environ['REACT_APP_DOCUMENTS_KB_ID'] = args.kb_id
            logger.info(f"Set REACT_APP_DOCUMENTS_KB_ID to {args.kb_id}")
        
        if args.kb_region:
            os.environ['REACT_APP_AWS_REGION'] = args.kb_region
            logger.info(f"Set REACT_APP_AWS_REGION to {args.kb_region}")
        
        # Get knowledge base ID and region
        kb_id = os.environ.get('REACT_APP_DOCUMENTS_KB_ID')
        kb_region = os.environ.get('REACT_APP_AWS_REGION')
        
        if not kb_id:
            logger.error("REACT_APP_DOCUMENTS_KB_ID not set")
            return
        
        if not kb_region:
            logger.error("REACT_APP_AWS_REGION not set")
            return
        
        logger.info(f"Testing knowledge base {kb_id} in region {kb_region}")
        
        try:
            # Create a Bedrock client
            bedrock_client = boto3.client(
                service_name='bedrock-agent-runtime',
                region_name=kb_region
            )
            
            # Test the knowledge base
            logger.info("Testing knowledge base with a simple query...")
            response = bedrock_client.retrieve(
                knowledgeBaseId=kb_id,
                retrievalQuery={
                    'text': 'amazon community policy'
                },
                retrievalConfiguration={
                    'vectorSearchConfiguration': {
                        'numberOfResults': 3
                    }
                }
            )
            
            # Process the response
            retrieval_results = response.get('retrievalResults', [])
            logger.info(f"Found {len(retrieval_results)} results")
            
            for i, result in enumerate(retrieval_results, 1):
                content = result.get('content', {}).get('text', '')
                source = result.get('location', {}).get('s3Location', {}).get('uri', 'Unknown source')
                score = result.get('score', 0)
                
                logger.info(f"Result {i}:")
                logger.info(f"  Content: {content[:100]}...")
                logger.info(f"  Source: {source}")
                logger.info(f"  Score: {score:.2f}")
            
            logger.info("Knowledge base connection successful!")
            
        except Exception as e:
            logger.error(f"Error testing knowledge base: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())

if __name__ == '__main__':
    main()
