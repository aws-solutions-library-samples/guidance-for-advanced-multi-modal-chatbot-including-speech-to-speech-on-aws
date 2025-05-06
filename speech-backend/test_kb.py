#!/usr/bin/env python3
"""
Test script for Bedrock Knowledge Base integration.
This script helps debug issues with the knowledge base integration by testing the retrieve_kb and retrieve_and_generation functions.
It supports testing both same-region and cross-region scenarios.
"""

import os
import argparse
import json
import logging
import bedrock_knowledge_bases as kb

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def main():
    parser = argparse.ArgumentParser(description='Test Bedrock Knowledge Base integration')
    parser.add_argument('--kb-id', help='Knowledge Base ID')
    parser.add_argument('--kb-region', help='Knowledge Base region (where the KB is located)')
    parser.add_argument('--backend-region', default='us-east-1', help='Backend region (where the Nova Sonic backend runs)')
    parser.add_argument('--query', default='amazon community policy', help='Query to search for')
    parser.add_argument('--use-rag', action='store_true', help='Use RAG (retrieve and generate)')
    parser.add_argument('--model-arn', default='anthropic.claude-3-haiku-20240307-v1:0', help='Model ARN for RAG')
    parser.add_argument('--debug', action='store_true', help='Enable debug logging')
    parser.add_argument('--cross-region', action='store_true', help='Test cross-region scenario')
    
    args = parser.parse_args()
    
    # Set debug level if requested
    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)
        logger.setLevel(logging.DEBUG)
    
    # Set environment variables
    if args.kb_id:
        os.environ['REACT_APP_DOCUMENTS_KB_ID'] = args.kb_id
        logger.info(f"Set REACT_APP_DOCUMENTS_KB_ID to {args.kb_id}")
    
    # Set Knowledge Base region
    kb_region = args.kb_region
    if not kb_region:
        kb_region = args.backend_region
        if args.cross_region:
            # For cross-region testing, use a different region than the backend
            if kb_region == 'us-east-1':
                kb_region = 'us-west-2'
            else:
                kb_region = 'us-east-1'
    
    os.environ['REACT_APP_AWS_REGION'] = kb_region
    logger.info(f"Set REACT_APP_AWS_REGION to {kb_region}")
    
    # Set backend region
    os.environ['AWS_DEFAULT_REGION'] = args.backend_region
    logger.info(f"Set AWS_DEFAULT_REGION to {args.backend_region}")
    
    # Check if this is a cross-region scenario
    if kb_region != args.backend_region:
        logger.info(f"Cross-region scenario: Knowledge Base in {kb_region}, Backend in {args.backend_region}")
    else:
        logger.info(f"Same-region scenario: Both Knowledge Base and Backend in {kb_region}")
    
    if args.use_rag:
        os.environ['USE_RAG'] = 'true'
        os.environ['RAG_MODEL_ARN'] = args.model_arn
        logger.info(f"Using RAG with model {args.model_arn}")
    else:
        os.environ['USE_RAG'] = 'false'
        logger.info("Using basic retrieval (no RAG)")
    
    # Print current environment variables
    logger.info("Current environment variables:")
    logger.info(f"REACT_APP_DOCUMENTS_KB_ID: {os.environ.get('REACT_APP_DOCUMENTS_KB_ID')}")
    logger.info(f"REACT_APP_AWS_REGION: {os.environ.get('REACT_APP_AWS_REGION')}")
    logger.info(f"AWS_DEFAULT_REGION: {os.environ.get('AWS_DEFAULT_REGION')}")
    logger.info(f"USE_RAG: {os.environ.get('USE_RAG')}")
    logger.info(f"RAG_MODEL_ARN: {os.environ.get('RAG_MODEL_ARN')}")
    
    # Test knowledge base integration
    query = args.query
    logger.info(f"Testing knowledge base integration with query: '{query}'")
    
    try:
        if args.use_rag:
            logger.info("Calling retrieve_and_generation...")
            result = kb.retrieve_and_generation(query)
            logger.info("RAG result:")
        else:
            logger.info("Calling retrieve_kb...")
            result = kb.retrieve_kb(query)
            logger.info("Basic retrieval result:")
        
        print("\n" + "="*80)
        print(f"QUERY: {query}")
        print("="*80)
        print(result)
        print("="*80 + "\n")
        
    except Exception as e:
        logger.error(f"Error testing knowledge base integration: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())

if __name__ == '__main__':
    main()
