from typing import Dict, List, Any
import json, os, logging, boto3
from operator import itemgetter
from functools import reduce

# Set up logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

class ContentProcessor:
    def get_time_range(self, timestamps: List[int]) -> str:
        """
        Get the time range from a list of timestamps.
        
        Args:
            timestamps (List[int]): List of timestamp values
            
        Returns:
            str: Time range in format "min-max" or "0-0" if empty
        """
        try:
            logger.info(f"Processing {len(timestamps)} timestamps")
            
            if not timestamps:
                logger.info("Empty timestamp list received, returning default range")
                return "0-0"
            
            # Single pass through the list instead of two separate passes for min/max
            if len(timestamps) == 1:
                return f"{timestamps[0]}-{timestamps[0]}"
                
            min_max = reduce(
                lambda acc, x: (min(acc[0], x), max(acc[1], x)),
                timestamps[1:],
                (timestamps[0], timestamps[0])
            )
            
            result = f"{min_max[0]}-{min_max[1]}"
            logger.info(f"Time range calculated: {result}")
            return result
                
        except Exception as e:
            logger.error(f"Error calculating time range: {str(e)}", exc_info=True)
            raise

    def format_summary_section(self, summary: str) -> str:
        """
        Formats the summary section with proper markdown heading.
        
        Args:
            summary (str): Raw summary text
        Returns:
            str: Formatted summary with markdown heading
        """
        try:
            logger.debug(f"Formatting summary section, length: {len(summary)}")
            
            # Pre-validate input
            if not summary:
                logger.warning("Empty summary received")
                return "# Summary\n"
            
            # Use stripped version only once and store
            formatted_summary = f"# Summary\n{summary.strip()}"
            logger.debug(f"Summary section formatted successfully")
            
            return formatted_summary
                
        except Exception as e:
            logger.error(f"Error formatting summary section: {str(e)}", exc_info=True)
            raise

    def group_content_by_timerange(
            self, 
            content_list: List[Dict[str, Any]]
        ) -> List[List[Dict[str, Any]]]:
            """
            Groups content items by time range chunks.
            
            Args:
                content_list: List of dictionaries containing timestamp data
            Returns:
                List of grouped content items
            """
            try:
                # Get chunk_size from environment variable with fallback
                chunk_size = int(os.getenv('CHUNK_SIZE_MS', '60000'))
                
                if not content_list:
                    logger.info("Empty content list received")
                    return []
        
                logger.info(f"Grouping {len(content_list)} items with chunk size {chunk_size}ms")
                
                # Pre-sort using operator.itemgetter for better performance
                from operator import itemgetter
                sorted_content = sorted(content_list, key=itemgetter('timestamp'))
                
                grouped_content = []
                current_group = []
                start_time = sorted_content[0]['timestamp']
                
                # Use enumerate for better performance monitoring
                for idx, item in enumerate(sorted_content):
                    current_time = item['timestamp']
                    time_diff = current_time - start_time
                    
                    if not current_group or time_diff <= chunk_size:
                        current_group.append(item)
                    else:
                        grouped_content.append(current_group)
                        current_group = [item]
                        start_time = current_time
                        
                    # Log progress for large datasets
                    if (idx + 1) % 10000 == 0:
                        logger.debug(f"Processed {idx + 1} items, created {len(grouped_content)} groups")
                
                # Add the last group if it exists
                if current_group:
                    grouped_content.append(current_group)
                
                logger.info(f"Grouping completed: created {len(grouped_content)} groups")
                return grouped_content
                
            except ValueError as ve:
                logger.error(f"Invalid CHUNK_SIZE_MS environment variable: {str(ve)}", exc_info=True)
                raise
            except Exception as e:
                logger.error(f"Error grouping content: {str(e)}", exc_info=True)
                raise
    
    def _binary_search(self, arr: List[Dict[str, Any]], target: int, start: int = 0) -> int:
        """Helper method for binary search on timestamp arrays."""
        left, right = start, len(arr) - 1
        
        while left <= right:
            mid = (left + right) // 2
            if arr[mid]['timestamp'] == target:
                return mid
            elif arr[mid]['timestamp'] < target:
                left = mid + 1
            else:
                right = mid - 1
                
        return left
    
    def format_content_group(self, group: List[Dict[str, Any]], _: List[Dict[str, Any]]) -> str:
        """
        Formats content group with all content in chronological order.
        """
        try:
            if not group:
                logger.debug("Empty group received")
                return ""

            timestamps = [item['timestamp'] for item in group]
            start_time, end_time = min(timestamps), max(timestamps)
            
            logger.debug(f"Processing content group: {start_time} to {end_time}")

            output_lines = []
            output_lines.append(f"\n[{start_time}] to [{end_time}]")

            # Sort content by timestamp
            sorted_content = sorted(group, key=itemgetter('timestamp'))
            
            for item in sorted_content:
                # Check if this is an audio transcript (contains speaker name)
                if 'type' in item and item['type'] == 'Audio':
                    output_lines.append(
                        f"[{item['timestamp']}] Audio Content: {item['text']}"
                    )
                else:
                    output_lines.append(
                        f"[{item['timestamp']}] Visual Content: {item['text']}"
                    )

            output_lines.append("---")
            
            result = "\n".join(output_lines)
            logger.debug(f"Formatted content group: {len(output_lines)} lines")
            return result

        except Exception as e:
            logger.error(f"Error formatting content group: {str(e)}", exc_info=True)
            raise

    def process_video_content(self, json_data: Dict[str, Any]) -> str:
        try:
            summary = json_data.get('video', {}).get('summary', '')
            visual_texts = []
            transcripts = []
            all_timestamps = []
            speakers = set()

            for chapter in json_data.get('chapters', []):
                # Process frames (visual content)
                if 'frames' in chapter:
                    for frame in chapter['frames']:
                        if 'text_lines' in frame:
                            timestamp = frame.get('timestamp_millis', 0) // 1000
                            all_timestamps.append(timestamp)
                            for line in frame['text_lines']:
                                if 'text' in line:
                                    visual_texts.append({
                                        'timestamp': timestamp,
                                        'text': line['text'].strip()
                                    })

                # Process audio segments
                for segment in chapter.get('audio_segments', []):
                    # Add debug logging
                    logger.debug(f"Processing audio segment: {segment}")
                    
                    if 'text' in segment and 'start_timestamp_millis' in segment:
                        timestamp = segment['start_timestamp_millis'] // 1000
                        all_timestamps.append(timestamp)
                        
                        speaker_name = segment.get('speaker', {}).get('speaker_name', 'Unknown')
                        if speaker_name and speaker_name != 'Unknown':
                            speakers.add(speaker_name)
                        
                        transcripts.append({
                            'timestamp': timestamp,
                            'text': f"{speaker_name}: {segment['text'].strip()}",
                            'type': 'Audio'  
                        })
                        
                        logger.debug(f"Added transcript: {timestamp} - {speaker_name}")

            # Debug logging
            logger.info(f"Found {len(visual_texts)} visual texts and {len(transcripts)} transcript segments")

            sections = []
            if summary:
                sections.append(self.format_summary_section(summary))

            # Get categories
            categories = set()
            for chapter in json_data.get('chapters', []):
                for category in chapter.get('iab_categories', []):
                    categories.add(category['category'])

            # Get time range including both visual and audio timestamps
            all_timestamps.extend([t['timestamp'] for t in transcripts])
            time_period = self.get_time_range(all_timestamps)

            metadata_section = [
                "# Metadata",
                f"Time Period: {time_period}",
                f"Categories: {', '.join(sorted(categories))}",
                "Content Type: Video",
                f"Speakers: {', '.join(sorted(speakers)) if speakers else 'None'}"
            ]
            sections.append("\n".join(metadata_section))

            sections.append("# TRANSCRIPT")

            # Combine and sort all content
            all_content = visual_texts + transcripts
            if all_content:
                # Sort by timestamp
                all_content.sort(key=lambda x: x['timestamp'])
                
                # Group content
                grouped_content = self.group_content_by_timerange(all_content)
                
                for group in grouped_content:
                    formatted_group = self.format_content_group(group, []) 
                    if formatted_group:
                        sections.append(formatted_group)

            return "\n\n".join(sections)

        except Exception as e:
            logger.error(f"Error processing video content: {str(e)}", exc_info=True)
            raise

    def process_image_content(self, json_data: Dict[str, Any]) -> str:
        try:
            sections = []
            
            # Extract and add summary
            summary = json_data.get('image', {}).get('summary', '')
            if summary:
                sections.append(self.format_summary_section(summary))

            # Extract and add metadata
            categories = set()
            # Get categories from image.iab_categories
            for category in json_data.get('image', {}).get('iab_categories', []):
                categories.add(category['category'])

            metadata_section = [
                "# Metadata",
                f"Categories: {', '.join(sorted(categories))}",
                "Content Type: Image"
            ]
            sections.append("\n".join(metadata_section))

            # Extract and add text content
            sections.append("# TEXT CONTENT")
            text_content = set()  # Using set to avoid duplicates
            
            # Get text from image.text_words
            for text_line in json_data.get('image', {}).get('text_lines', []):
                if 'text' in text_line:
                    text_content.add(text_line['text'].strip())

            if text_content:
                sections.append("\n".join(sorted(text_content)))
            else:
                sections.append("No text content detected")

            return "\n\n".join(sections)

        except Exception as e:
            raise Exception(f"Error processing image content: {str(e)}")

    def process_audio_content(self, json_data: Dict[str, Any]) -> str:
        try:
            sections = []
            
            # Add summary section
            summary = json_data.get('audio', {}).get('summary', '')
            if summary:
                sections.append(f"# Audio Summary\n{summary}")
    
            # Get all unique speakers from audio segments
            audio_segments = json_data.get('audio', {}).get('audio_segments', [])
            speakers = set()
            for segment in audio_segments:
                speaker = segment.get('speaker', {})
                speaker_name = speaker.get('speaker_name')
                if speaker_name and speaker_name != 'None':
                    speakers.add(speaker_name)
            
            # Format speakers string
            speakers_str = ', '.join(sorted(speakers)) if speakers else 'None'
    
            # Add metadata section
            metadata = json_data.get('metadata', {})
            duration_seconds = metadata.get('duration_millis', 0) // 1000  
            metadata_section = [
                "# Metadata",
                f"Time Period: 0-{duration_seconds}s",
                "Categories: Audio Content",
                f"Speakers: {speakers_str}"
            ]
            sections.append("\n".join(metadata_section))
    
            # Add transcript section
            sections.append("# TRANSCRIPT")
            
            # Process audio segments
            transcript_lines = []
            
            for segment in audio_segments:
                # Convert timestamps to seconds using integer division
                start_time = segment.get('start_timestamp_millis', 0) // 1000
                end_time = segment.get('end_timestamp_millis', 0) // 1000
                text = segment.get('text', '')
                
                # Safely get speaker information
                speaker = segment.get('speaker', {})
                speaker_name = speaker.get('speaker_name', 'Unknown')
                speaker_label = speaker.get('speaker_label', 'Unknown')
                
                # Use speaker_label if speaker_name is 'None' or not present
                speaker_info = speaker_name if speaker_name and speaker_name != 'None' else speaker_label
                
                # Format the transcript line matching the expected format with whole seconds
                transcript_lines.append(f"\n[{start_time}s] to [{end_time}s]")
                transcript_lines.append(f"[{start_time}s] Audio Content: {speaker_info}: {text}")
                transcript_lines.append("---")
    
            if transcript_lines:
                sections.append("\n".join(transcript_lines))
            else:
                sections.append("No transcript available")
    
            return "\n\n".join(sections)
    
        except Exception as e:
            raise Exception(f"Error processing audio content: {str(e)}")
    
    def process_document_content(self, json_data: Dict[str, Any]) -> str:
        try:
            sections = []
            elements = json_data.get('elements', [])

            # Document Summary section
            doc_info = json_data.get('document', {})
            if doc_info.get('description') or doc_info.get('summary'):
                sections.append("# DOCUMENT SUMMARY")
                if doc_info.get('description'):
                    sections.append(doc_info['description'])
                if doc_info.get('summary'):
                    sections.append(doc_info['summary'])

            # Metadata section
            metadata = json_data.get('metadata', {})
            if metadata:
                metadata_lines = ["# METADATA"]
                if 'number_of_pages' in metadata:
                    metadata_lines.append(f"Pages: {metadata['number_of_pages']}")
                if doc_info.get('statistics'):
                    stats = doc_info['statistics']
                    metadata_lines.append("Statistics:")
                    if 'element_count' in stats:
                        metadata_lines.append(f"- Elements: {stats['element_count']}")
                    if 'table_count' in stats:
                        metadata_lines.append(f"- Tables: {stats['table_count']}")
                    if 'figure_count' in stats:
                        metadata_lines.append(f"- Figures: {stats['figure_count']}")
                    if 'word_count' in stats:
                        metadata_lines.append(f"- Words: {stats['word_count']}")
                sections.append("\n".join(metadata_lines))

            # CONTENT section
            content_lines = ["# CONTENT"]
            text_elements = [elem for elem in elements if elem.get('type') == 'TEXT']
            for elem in text_elements:
                text_content = elem.get('representation', {}).get('text', '')
                if text_content:
                    locations = elem.get('locations', [])
                    if locations:
                        page_indices = [loc.get('page_index', 0) for loc in locations]
                        page_info = f"[TEXT - Page {', '.join(map(str, page_indices))}]"
                        sub_type = elem.get('sub_type')
                        if sub_type:
                            content_lines.append(f"{page_info} [{sub_type}] {text_content}")
                        else:
                            content_lines.append(f"{page_info} {text_content}")
            sections.append("\n".join(content_lines))
            
            # TABLES section
            table_elements = [elem for elem in elements if elem.get('type') == 'TABLE']
            if table_elements:
                table_lines = ["# TABLES"]
                for table in table_elements:
                    locations = table.get('locations', [])
                    if locations:
                        page_indices = [loc.get('page_index', 0) for loc in locations]
                        table_content = table.get('representation', {}).get('text', '')
                        if table_content:
                            page_info = f"[TABLE - Page {', '.join(map(str, page_indices))}]"
                            sub_type = table.get('sub_type')
                            if sub_type:
                                table_lines.append(f"{page_info} [{sub_type}]")
                            else:
                                table_lines.append(page_info)
                            table_lines.append(table_content)
                            table_lines.append("---")
                sections.append("\n".join(table_lines))
            
            # FIGURES section
            figure_elements = [elem for elem in elements if elem.get('type') == 'FIGURE']
            if figure_elements:
                figure_lines = ["# FIGURES"]
                for figure in figure_elements:
                    figure_section = []
                    locations = figure.get('locations', [])
                    if locations:
                        page_indices = [loc.get('page_index', 0) for loc in locations]
                        page_info = f"[FIGURE - Page {', '.join(map(str, page_indices))}]"
                        sub_type = figure.get('sub_type')
                        if sub_type:
                            figure_section.append(f"{page_info} [{sub_type}]")
                        else:
                            figure_section.append(page_info)
                    
                    if figure.get('title'):
                        figure_section.append(f"Title: {figure['title']}")
                    if figure.get('representation', {}).get('text'):
                        figure_section.append(f"Text: {figure['representation']['text']}")
                    if figure.get('summary'):
                        figure_section.append(f"Summary: {figure['summary']}")
                    figure_lines.append("\n".join(figure_section))
                    figure_lines.append("---")
                sections.append("\n".join(figure_lines))
            
            return "\n\n".join(sections)
            
        except Exception as e:
            raise Exception(f"Error processing document content: {str(e)}")

    def process_content(self, json_data: Dict[str, Any]) -> str:
        try:
            # Get semantic_modality from metadata
            semantic_modality = json_data.get('metadata', {}).get('semantic_modality', '').upper()
            
            if semantic_modality == 'VIDEO':
                return self.process_video_content(json_data)
            elif semantic_modality == 'IMAGE':
                return self.process_image_content(json_data)
            elif semantic_modality == 'AUDIO':
                return self.process_audio_content(json_data)
            elif semantic_modality == 'DOCUMENT':
                return self.process_document_content(json_data)
            else:
                raise Exception(f"Unsupported or unknown content type: {semantic_modality}")

        except Exception as e:
            raise Exception(f"Error processing content: {str(e)}")

def lambda_handler(event, context):
    logger.info(f"Received BDA Invocation response: {event}")
    if event['detail-type'] == 'Bedrock Data Automation Job Succeeded':
        try:
            # Extract S3 details from the event
            detail = event['detail']
            output_bucket = os.environ['ORGANIZED_BUCKET']
            base_path = detail['output_s3_location']['name']
            
            # Get original filename with underscore and extension without dot
            original_filename = f"{os.path.splitext(detail['input_s3_object']['name'])[0]}_{os.path.splitext(detail['input_s3_object']['name'])[1][1:]}"
            # Construct the full S3 path for result.json
            result_key = f"{base_path}/standard_output/0/result.json"
            
            # Create S3 client
            s3_client = boto3.client('s3')
            
            # Download the result.json file
            response = s3_client.get_object(
                Bucket=output_bucket,
                Key=result_key
            )
            logger.info(f"Downloaded BDA invocation result")
            # Read the content of the file
            result_content = json.loads(response['Body'].read().decode('utf-8'))

            processor = ContentProcessor()
            processed_result = processor.process_content(result_content)

            # Save processed result to Documents folder
            processed_key = f"Documents/{original_filename}.txt"
            
            s3_client.put_object(
                Bucket=output_bucket,
                Key=processed_key,
                Body=processed_result.encode('utf-8'),
                ContentType='text/plain'
            )
            
            logger.info(f"Saved processed result to s3://{output_bucket}/{processed_key}")
            
            return {
                'statusCode': 200,
                'body': json.dumps({
                    'message': 'Successfully processed result.json',
                    'result': result_content
                })
            }
            
        except Exception as e:
            print(f"Error processing result.json: {str(e)}")
            return {
                'statusCode': 500,
                'body': json.dumps({
                    'message': 'Error processing result.json',
                    'error': str(e)
                })
            }
