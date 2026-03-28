from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv
from mangum import Mangum
import os
import requests
import boto3
import json
from datetime import datetime, timedelta
from collections import Counter
import re

load_dotenv()

AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
DYNAMODB_TABLE = os.getenv("DYNAMODB_TABLE", "job-market-cache")
SQS_QUEUE_URL = os.getenv("SQS_QUEUE_UR","https://sqs.us-east-1.amazonaws.com/381491855715/job-market-requests")

app = FastAPI(title="Job Market Analyser API")


class JobRequest(BaseModel):
    job_title: str
    location: str
    country: str
    
def get_adzuna_country_code(country: str):
    mapping = {
        "United Kingdom": "gb",
        "Ireland": "ie",
        "Germany": "de",
        "France": "fr",
        "Spain": "es",
        "Italy": "it"
    }
    return mapping.get(country, "gb")

def build_cache_key(job_title: str, location: str, country: str) -> str:
    clean_job = " ".join(job_title.strip().lower().split())
    clean_location = " ".join(location.strip().lower().split())
    clean_country = " ".join(country.strip().lower().split())
    return f"{clean_job}#{clean_location}#{clean_country}"

def send_job_request_to_sqs(job_title: str, location: str, country: str):
    try:
        if not SQS_QUEUE_URL:
            print("DEBUG: SQS_QUEUE_URL not configured, skipping SQS send")
            return

        sqs = boto3.client("sqs", region_name=AWS_REGION)

        message_body = {
            "job_title": job_title,
            "location": location,
            "country": country,
            "requested_at": datetime.utcnow().isoformat()
        }

        response = sqs.send_message(
            QueueUrl=SQS_QUEUE_URL,
            MessageBody=json.dumps(message_body)
        )

        print(f"DEBUG: Sent message to SQS. MessageId={response.get('MessageId')}")

    except Exception as e:
        print(f"DEBUG: Failed to send message to SQS: {str(e)}")
        

def get_dynamodb_table():
    dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
    return dynamodb.Table(DYNAMODB_TABLE)


def get_cached_result(cache_key: str):
    try:
        print(f"DEBUG: Checking cache for key={cache_key}")
        table = get_dynamodb_table()
        response = table.get_item(
            Key={"cache_key": cache_key},
            ConsistentRead=True
        )

        item = response.get("Item")

        if not item:
            print("DEBUG: Cache miss")
            return None

        expires_at = int(item.get("expires_at", 0))
        now_ts = int(datetime.utcnow().timestamp())

        if expires_at < now_ts:
            print("DEBUG: Cache expired")
            return None

        raw_data = item.get("response_data")

        if isinstance(raw_data, str):
            cached_data = json.loads(raw_data)
        else:
            cached_data = raw_data

        print("DEBUG: Cache hit")
        return cached_data

    except Exception as e:
        print(f"DEBUG: Cache read failed: {str(e)}")
        return None


def save_to_cache(cache_key: str, response_data: dict):
    try:
        expires_at = int((datetime.utcnow() + timedelta(hours=24)).timestamp())

        clean_data = {
            "avg_salary": response_data["avg_salary"],
            "top_skills": response_data["top_skills"],
            "demand_score": response_data["demand_score"],
            "summary": response_data["summary"]
        }

        print(f"DEBUG: Saving cache for key={cache_key}")
        table = get_dynamodb_table()
        table.put_item(
            Item={
                "cache_key": cache_key,
                "expires_at": expires_at,
                "response_data": json.dumps(clean_data)
            }
        )

        print("DEBUG: Cache saved successfully")

    except Exception as e:
        print(f"DEBUG: Cache write failed: {str(e)}")


def fetch_adzuna_jobs(job_title: str, location: str, country_name: str):
    app_id = os.getenv("ADZUNA_APP_ID")
    app_key = os.getenv("ADZUNA_APP_KEY")
    country = get_adzuna_country_code(country_name)

    if not app_id or not app_key:
        raise HTTPException(status_code=500, detail="Adzuna API credentials are missing")

    url = f"https://api.adzuna.com/v1/api/jobs/{country}/search/1"
    params = {
        "app_id": app_id,
        "app_key": app_key,
        "what": job_title,
        "where": location,
        "results_per_page": 20
    }

    response = requests.get(url, params=params, timeout=20)

    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Adzuna API failed for country '{country}' with status {response.status_code}: {response.text[:300]}"
        )
    return response.json()


def extract_avg_salary(results):
    salaries = []

    for job in results:
        if job.get("salary_min") and job.get("salary_max"):
            salaries.append((job["salary_min"] + job["salary_max"]) / 2)
        elif job.get("salary_min"):
            salaries.append(job["salary_min"])
        elif job.get("salary_max"):
            salaries.append(job["salary_max"])

    if not salaries:
        return "Salary data not available"

    return round(sum(salaries) / len(salaries), 2)



FRONTEND_SKILLS = [
    "JavaScript", "TypeScript", "React", "Angular", "Vue",
    "HTML", "CSS", "Redux", "Next.js", "Tailwind"
]

BACKEND_SKILLS = [
    "Python", "Java", "Node.js", "Django", "Flask", "FastAPI",
    "Spring", "SQL", "PostgreSQL", "MongoDB"
]

DEVOPS_SKILLS = [
    "AWS", "Azure", "GCP", "Docker", "Kubernetes",
    "Terraform", "CI/CD", "Linux"
]

DATA_SKILLS = [
    "Machine Learning", "Data Analysis", "Pandas",
    "NumPy", "Spark", "Hadoop", "Tableau", "Power BI"
]


def extract_top_skills(results, job_title):
    job_title = job_title.lower()

    if "frontend" in job_title or "ui" in job_title:
        skill_pool = FRONTEND_SKILLS
    elif "backend" in job_title or "api" in job_title:
        skill_pool = BACKEND_SKILLS
    elif "devops" in job_title or "cloud" in job_title:
        skill_pool = DEVOPS_SKILLS
    elif "data" in job_title or "analyst" in job_title or "ml" in job_title:
        skill_pool = DATA_SKILLS
    else:
        skill_pool = FRONTEND_SKILLS + BACKEND_SKILLS + DEVOPS_SKILLS

    text_blob = " ".join(
        f"{job.get('title', '')} {job.get('description', '')}"
        for job in results
    ).lower()

    found_skills = []

    for skill in skill_pool:
        pattern = r"\b" + re.escape(skill.lower()) + r"\b"
        matches = re.findall(pattern, text_blob)
        if matches:
            found_skills.extend([skill] * len(matches))

    if not found_skills:
        if "frontend" in job_title:
            return ["JavaScript", "React", "HTML", "CSS"]
        elif "backend" in job_title:
            return ["Python", "SQL", "API", "PostgreSQL"]
        elif "devops" in job_title or "cloud" in job_title:
            return ["AWS", "Docker", "Kubernetes", "Terraform"]
        return ["Skill data not available"]

    ranked_skills = [skill for skill, _ in Counter(found_skills).most_common(6)]
    return ranked_skills
    
    
def calculate_demand_score(count):
    if count >= 20:
        return 75
    if count >= 10:
        return 60
    return 30


@app.get("/")
def root():
    return {"message": "API is running"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyse-job")
def analyse_job(payload: JobRequest):
    cache_key = build_cache_key(payload.job_title, payload.location, payload.country)
    print(f"DEBUG: cache_key={cache_key}")

    cached_result = get_cached_result(cache_key)

    if cached_result:
        print("DEBUG: RETURNING CACHE")
        return {
            **cached_result,
            "data_source": "cache"
        }

    print("DEBUG: CALLING ADZUNA")

    data = fetch_adzuna_jobs(payload.job_title, payload.location, payload.country)
    results = data.get("results", [])

    response_data = {
        "avg_salary": extract_avg_salary(results),
        "top_skills": extract_top_skills(results, payload.job_title),
        "demand_score": calculate_demand_score(len(results)),
        "summary": f"{len(results)} jobs found",
        "data_source": "live"
    }

    save_to_cache(cache_key, response_data)
    return response_data
    
@app.post("/submit-job-request")
def submit_job_request(payload: JobRequest):
    send_job_request_to_sqs(payload.job_title, payload.location, payload.country)

    return {
        "message": "Job request submitted successfully",
        "job_title": payload.job_title,
        "location": payload.location,
        "country": payload.country,
        "status": "queued"
    }


handler = Mangum(app)