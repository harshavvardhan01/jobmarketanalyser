import json
import os
import uuid
from datetime import datetime

import boto3

AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
EVENTS_TABLE = os.getenv("EVENTS_TABLE", "job-request-events")


def get_events_table():
    dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
    return dynamodb.Table(EVENTS_TABLE)


def save_event(payload: dict):
    table = get_events_table()

    request_id = str(uuid.uuid4())

    item = {
        "request_id": request_id,
        "job_title": payload.get("job_title", "N/A"),
        "location": payload.get("location", "N/A"),
        "country": payload.get("country", "N/A"),
        "requested_at": payload.get("requested_at", "N/A"),
        "processed_at": datetime.utcnow().isoformat(),
        "status": "processed"
    }

    table.put_item(Item=item)
    print(f"DEBUG: Saved event to DynamoDB with request_id={request_id}")

    return item


def lambda_handler(event, context):
    print("DEBUG: SQS consumer invoked")

    records = event.get("Records", [])
    processed = []

    for record in records:
        body = record.get("body", "")
        print(f"DEBUG: Raw message body: {body}")

        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            payload = {"raw_body": body}

        saved_item = save_event(payload)
        processed.append(saved_item)

    return {
        "statusCode": 200,
        "processed_count": len(processed),
        "processed_messages": processed
    }