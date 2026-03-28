import { useState } from "react";
import "./App.css";

const API_BASE_URL = "https://rae0ounh2b.execute-api.us-east-1.amazonaws.com";
const COUNTRY_CITY_MAP = {
  "United Kingdom": ["London", "Manchester", "Birmingham", "Leeds", "Liverpool"],
  Germany: ["Berlin", "Munich", "Hamburg", "Frankfurt", "Cologne"],
  France: ["Paris", "Lyon", "Marseille", "Toulouse", "Nice"],
  Spain: ["Madrid", "Barcelona", "Valencia", "Seville", "Malaga"],
  Italy: ["Milan", "Rome", "Turin", "Naples", "Bologna"]
};

function App() {
  const [jobTitle, setJobTitle] = useState("");
  const [location, setLocation] = useState("London");
  const [country, setCountry] = useState("United Kingdom");

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [countryInfo, setCountryInfo] = useState(null);
  const [aiSummary, setAiSummary] = useState("");
  const [error, setError] = useState("");
  const [queueStatus, setQueueStatus] = useState(null);
  const [lastQueuedRequest, setLastQueuedRequest] = useState(null);

  const fetchCountryInfo = async (countryName) => {
    const response = await fetch(
      `https://restcountries.com/v3.1/name/${encodeURIComponent(countryName)}?fullText=true`
    );

    if (!response.ok) {
      throw new Error("Failed to fetch country information");
    }

    const data = await response.json();
    const countryData = data[0];

    return {
      name: countryData.name?.common || "N/A",
      capital: countryData.capital?.[0] || "N/A",
      region: countryData.region || "N/A",
      flag: countryData.flags?.png || "",
      currency:
        countryData.currencies
          ? Object.keys(countryData.currencies).join(", ")
          : "N/A",
    };
  };

  const fetchGeminiSummary = async (jobData, jobTitleValue, locationValue) => {
    const API_KEY = "AIzaSyDgMN_CANn_nVuurEbQ38KhtJT_bQ2vYpo";

    const prompt = `
Generate a short 1-line professional job market summary.
Job: ${jobTitleValue}
Location: ${locationValue}
Average Salary: ${jobData.avg_salary}
Top Skills: ${jobData.top_skills?.join(", ")}
Demand Score: ${jobData.demand_score}
Summary: ${jobData.summary}
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || "Gemini request failed");
    }

    return (
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "AI summary not available"
    );
  };

  const handleAnalyse = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    setCountryInfo(null);
    setAiSummary("");
    setQueueStatus(null);
    setLastQueuedRequest(null);

    try {
      const [jobResponse, fetchedCountryInfo] = await Promise.all([
        fetch(`${API_BASE_URL}/analyse-job`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            job_title: jobTitle,
            location: location,
            country: country,
          }),
        }),
        fetchCountryInfo(country),
      ]);

      const text = await jobResponse.text();

      if (!jobResponse.ok) {
        throw new Error(`API ${jobResponse.status}: ${text}`);
      }

      const jobData = JSON.parse(text);
      const summary = await fetchGeminiSummary(jobData, jobTitle, location);

      setResult(jobData);
      setCountryInfo(fetchedCountryInfo);
      setAiSummary(summary);
      fetch(`${API_BASE_URL}/submit-job-request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          job_title: jobTitle,
          location: location,
          country: country,
        }),
      })
        .then(async (response) => {
          const queueData = await response.json();

          if (!response.ok) {
            throw new Error(queueData.detail || "Queue submission failed");
          }

          setQueueStatus({
            success: true,
            message: queueData.message || "Job request submitted successfully",
            status: queueData.status || "queued",
          });

          setLastQueuedRequest({
            job_title: queueData.job_title,
            location: queueData.location,
            country: queueData.country,
            queued_at: new Date().toLocaleString(),
          });
        })
        .catch((queueError) => {
          console.error("Background queue submission failed:", queueError);

          setQueueStatus({
            success: false,
            message: "Main analysis worked, but async queue submission failed.",
            status: "failed",
          });
        });
    } catch (err) {
      console.error(err);
      setError(err.message || "Something went wrong while analysing the job market.");
    } finally {
      setLoading(false);
    }
  };

  const demandPercent = result ? Math.min(result.demand_score, 100) : 0;
    const getDemandLabel = (score) => {
      if (score >= 75) return "High";
      if (score >= 45) return "Medium";
      return "Low";
    };
  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">JM</div>
          <div>
            <h1>Job Market Analyser</h1>
            <p>Smart hiring insights for modern job seekers</p>
          </div>
        </div>
        <div className="topbar-badge">Cloud-Powered Insights</div>
      </header>

      <main className="main-content">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">Analyse jobs like a real hiring platform</p>
            <h2>Find salary, demand, skills, country context, and AI market insight in one place.</h2>
            <p className="hero-text">
              Search any role and location to get real-time market analysis powered by AWS,
              public APIs, and AI-generated insights.
            </p>
          </div>

          <div className="search-card">
            <h3>Search Job Market</h3>
            <form onSubmit={handleAnalyse} className="form-grid">
              <div className="field">
                <label>Job Title</label>
                <input
                  type="text"
                  placeholder="e.g. Frontend Developer"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  required
                />
              </div>

              <div className="field">
                <label>City / Location</label>
                <select value={location} onChange={(e) => setLocation(e.target.value)}>
                  {COUNTRY_CITY_MAP[country].map((city) => (
                    <option key={city} value={city}>
                      {city}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field full-width">
                <label>Country</label>
                <select
                  value={country}
                  onChange={(e) => {
                    const selectedCountry = e.target.value;
                    setCountry(selectedCountry);
                    setLocation(COUNTRY_CITY_MAP[selectedCountry][0]);
                  }}
                >
                  {Object.keys(COUNTRY_CITY_MAP).map((countryName) => (
                    <option key={countryName} value={countryName}>
                      {countryName}
                    </option>
                  ))}
                </select>
              </div>

              <button type="submit" className="primary-btn full-width" disabled={loading}>
                {loading ? "Analysing Market..." : "Analyse Job Market"}
              </button>
            </form>

            {error && <div className="error-banner">{error}</div>}
          </div>
        </section>
        {loading && (
          <section className="loading-story">
            <div className="loading-card">
              <div className="student-scene">
                <div className="student-avatar stressed">😰</div>
                <div className="floating-doc doc1">📄</div>
                <div className="floating-doc doc2">📄</div>
                <div className="floating-doc doc3">📄</div>
              </div>
        
              <div className="loading-copy">
                <h3>Searching the job market for you...</h3>
                <p>
                  Checking salaries, analysing demand, finding top skills, and generating AI insight.
                </p>
        
                <div className="loading-steps">
                  <span>Scanning jobs</span>
                  <span>Checking country data</span>
                  <span>Generating insight</span>
                </div>
        
                <div className="loading-bar">
                  <div className="loading-bar-fill" />
                </div>
              </div>
            </div>
          </section>
        )}
        {result && (
          <>
            <div className="success-banner">
              {queueStatus && (
                <section className="pipeline-card fade-up">
                  <div className="pipeline-header">
                    <div className="pipeline-icon">☁️</div>
                    <div>
                      <h3>Scalable Cloud Pipeline Triggered</h3>
                      <p>
                        This request used both the real-time analysis flow and the asynchronous
                        serverless processing pipeline.
                      </p>
                    </div>
                  </div>
              
                  <div className="pipeline-grid">
                    <div className="pipeline-block">
                      <h4>User-Facing Flow</h4>
                      <div className="pipeline-item">✅ Immediate analysis completed</div>
                      <div className="pipeline-item">✅ Salary, skills, and demand returned</div>
                      <div className="pipeline-item">✅ AI insight generated for the user</div>
                    </div>
              
                    <div className="pipeline-block">
                      <h4>Scalable Backend Flow</h4>
                      <div className="pipeline-item">✅ Async request submitted</div>
                      <div className="pipeline-item">✅ SQS queue received the request</div>
                      <div className="pipeline-item">✅ Consumer Lambda processes in background</div>
                      <div className="pipeline-item">✅ DynamoDB stores request event</div>
                    </div>
                  </div>
              
                  {lastQueuedRequest && (
                    <div className="queued-request-meta">
                      <div>
                        <span>Job Title</span>
                        <strong>{lastQueuedRequest.job_title}</strong>
                      </div>
                      <div>
                        <span>Location</span>
                        <strong>{lastQueuedRequest.location}</strong>
                      </div>
                      <div>
                        <span>Country</span>
                        <strong>{lastQueuedRequest.country}</strong>
                      </div>
                      <div>
                        <span>Triggered At</span>
                        <strong>{lastQueuedRequest.queued_at}</strong>
                      </div>
                    </div>
                  )}
                </section>
              )}
              <div className="success-avatar">😌</div>
              <div>
                <strong>Market analysis ready</strong>
                <p>
                  Great news — we found {result.summary.toLowerCase()} with{" "}
                  {getDemandLabel(result.demand_score).toLowerCase()} demand.
                </p>
              </div>
            </div>
            <section className="stats-grid">
              <div className="stat-card">
                <p className="stat-label">Average Salary</p>
                <h3>
                  {typeof result.avg_salary === "number"
                    ? `£${result.avg_salary.toLocaleString()}`
                    : result.avg_salary}
                </h3>
              </div>

              <div className="stat-card">
                <p className="stat-label">Demand Score</p>
                <h3>{result.demand_score}/100</h3>
                <span className={`demand-pill ${getDemandLabel(result.demand_score).toLowerCase()}`}>
                  {getDemandLabel(result.demand_score)} Demand
                </span>
              </div>

              <div className="stat-card">
                <p className="stat-label">Data Source</p>
                <h3>
                  <span
                    className={
                      result.data_source === "cache"
                        ? "status-badge cache"
                        : "status-badge live"
                    }
                  >
                    {result.data_source}
                  </span>
                </h3>
              </div>

              <div className="stat-card">
                <p className="stat-label">Country</p>
                <h3>{countryInfo?.name || country}</h3>
              </div>
            </section>

            <section className="content-grid">
              <div className="card fade-up">
                <div className="card-header">
                  <h3>Top Skills</h3>
                  <p>Most relevant skills found in matching job listings</p>
                </div>
                <div className="skills-wrap">
                  {result.top_skills?.map((skill) => (
                    <span key={skill} className="skill-chip">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>

              <div className="card fade">
                <div className="card-header">
                  <h3>Market Demand</h3>
                  <p>Demand estimated from matching job volume</p>
                </div>
                <div className="meter-block">
                  <div className="meter-top">
                    <span>Demand Strength</span>
                    <strong>{result.demand_score}%</strong>
                  </div>
                  <div className="meter-track">
                    <div
                      className="meter-fill"
                      style={{ width: `${demandPercent}%` }}
                    />
                  </div>
                  <p className="summary-text">{result.summary}</p>
                </div>
              </div>

              {aiSummary && (
                <div className="card insight-card fade-up">
                  <div className="card-header">
                    <h3>AI Market Insight</h3>
                    <p>Generated summary based on market response and skills</p>
                  </div>
                  <p className="insight-text">{aiSummary}</p>
                </div>
              )}

              {countryInfo && (
                <div className="card fade-up">
                  <div className="card-header">
                    <h3>Country Overview</h3>
                    <p>Context from REST Countries</p>
                  </div>
                  <div className="country-block">
                    {countryInfo.flag && (
                      <img
                        src={countryInfo.flag}
                        alt={countryInfo.name}
                        className="flag"
                      />
                    )}
                    <div className="country-meta">
                      <div>
                        <span>Country</span>
                        <strong>{countryInfo.name}</strong>
                      </div>
                      <div>
                        <span>Capital</span>
                        <strong>{countryInfo.capital}</strong>
                      </div>
                      <div>
                        <span>Region</span>
                        <strong>{countryInfo.region}</strong>
                      </div>
                      <div>
                        <span>Currency</span>
                        <strong>{countryInfo.currency}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

export default App;