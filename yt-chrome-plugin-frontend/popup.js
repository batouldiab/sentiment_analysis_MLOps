// popup.js

const API_URL = 'http://127.0.0.1:5000';
const STORAGE_KEY = 'yt_data_api_key';

document.addEventListener("DOMContentLoaded", async () => {
  const outputDiv = document.getElementById("output");
  const setupDiv = document.getElementById("api-key-setup");
  const settingsLink = document.getElementById("settings-link");
  const keyInput = document.getElementById("api-key-input");
  const saveButton = document.getElementById("api-key-save");
  const errorDiv = document.getElementById("api-key-error");

  settingsLink.addEventListener("click", () => {
    showSetup();
  });

  saveButton.addEventListener("click", async () => {
    const candidate = keyInput.value.trim();
    if (!candidate) {
      showError("Please paste a key.");
      return;
    }

    saveButton.disabled = true;
    saveButton.textContent = "Validating...";
    errorDiv.style.display = "none";

    const isValid = await validateApiKey(candidate);
    if (!isValid) {
      saveButton.disabled = false;
      saveButton.textContent = "Save Key";
      showError("This key was rejected by the YouTube Data API. Check that the key is correct and that YouTube Data API v3 is enabled for it.");
      return;
    }

    await setStoredKey(candidate);
    saveButton.disabled = false;
    saveButton.textContent = "Save Key";
    setupDiv.style.display = "none";
    settingsLink.style.display = "block";
    runAnalysis(candidate);
  });

  keyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveButton.click();
  });

  const storedKey = await getStoredKey();
  if (!storedKey) {
    showSetup();
    return;
  }

  settingsLink.style.display = "block";
  runAnalysis(storedKey);

  function showSetup() {
    setupDiv.style.display = "block";
    outputDiv.innerHTML = "";
    keyInput.value = "";
    errorDiv.style.display = "none";
    keyInput.focus();
  }

  function showError(message) {
    errorDiv.textContent = message;
    errorDiv.style.display = "block";
  }

  async function runAnalysis(apiKey) {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const url = tabs[0].url;
      const youtubeRegex = /^https:\/\/(?:www\.)?youtube\.com\/watch\?v=([\w-]{11})/;
      const match = url.match(youtubeRegex);

      if (!match || !match[1]) {
        outputDiv.innerHTML = "<p>This is not a valid YouTube URL.</p>";
        return;
      }

      const videoId = match[1];
      outputDiv.innerHTML = `<div class="section-title">YouTube Video ID</div><p>${videoId}</p><p>Fetching comments...</p>`;

      const comments = await fetchComments(videoId, apiKey);
      if (comments === null) return; // auth failure path
      if (comments.length === 0) {
        outputDiv.innerHTML += "<p>No comments found for this video.</p>";
        return;
      }

      outputDiv.innerHTML += `<p>Fetched ${comments.length} comments. Performing sentiment analysis...</p>`;
      const predictions = await getSentimentPredictions(comments);
      if (!predictions) return;

      const sentimentCounts = { "1": 0, "0": 0, "-1": 0 };
      const sentimentData = [];
      const totalSentimentScore = predictions.reduce((sum, item) => sum + parseInt(item.sentiment), 0);
      predictions.forEach((item) => {
        sentimentCounts[item.sentiment]++;
        sentimentData.push({
          timestamp: item.timestamp,
          sentiment: parseInt(item.sentiment)
        });
      });

      const totalComments = comments.length;
      const uniqueCommenters = new Set(comments.map(c => c.authorId)).size;
      const totalWords = comments.reduce((sum, c) => sum + c.text.split(/\s+/).filter(w => w.length > 0).length, 0);
      const avgWordLength = (totalWords / totalComments).toFixed(2);
      const avgSentimentScore = (totalSentimentScore / totalComments).toFixed(2);
      const normalizedSentimentScore = (((parseFloat(avgSentimentScore) + 1) / 2) * 10).toFixed(2);

      outputDiv.innerHTML += `
        <div class="section">
          <div class="section-title">Comment Analysis Summary</div>
          <div class="metrics-container">
            <div class="metric">
              <div class="metric-title">Total Comments</div>
              <div class="metric-value">${totalComments}</div>
            </div>
            <div class="metric">
              <div class="metric-title">Unique Commenters</div>
              <div class="metric-value">${uniqueCommenters}</div>
            </div>
            <div class="metric">
              <div class="metric-title">Avg Comment Length</div>
              <div class="metric-value">${avgWordLength} words</div>
            </div>
            <div class="metric">
              <div class="metric-title">Avg Sentiment Score</div>
              <div class="metric-value">${normalizedSentimentScore}/10</div>
            </div>
          </div>
        </div>
      `;

      outputDiv.innerHTML += `
        <div class="section">
          <div class="section-title">Sentiment Analysis Results</div>
          <p>See the pie chart below for sentiment distribution.</p>
          <div id="chart-container"></div>
        </div>`;
      await fetchAndDisplayChart(sentimentCounts);

      outputDiv.innerHTML += `
        <div class="section">
          <div class="section-title">Sentiment Trend Over Time</div>
          <div id="trend-graph-container"></div>
        </div>`;
      await fetchAndDisplayTrendGraph(sentimentData);

      outputDiv.innerHTML += `
        <div class="section">
          <div class="section-title">Comment Wordcloud</div>
          <div id="wordcloud-container"></div>
        </div>`;
      await fetchAndDisplayWordCloud(comments.map(c => c.text));

      outputDiv.innerHTML += `
        <div class="section">
          <div class="section-title">Top 25 Comments with Sentiments</div>
          <ul class="comment-list">
            ${predictions.slice(0, 25).map((item, index) => `
              <li class="comment-item">
                <span>${index + 1}. ${item.comment}</span><br>
                <span class="comment-sentiment">Sentiment: ${item.sentiment}</span>
              </li>`).join('')}
          </ul>
        </div>`;
    });
  }

  async function fetchComments(videoId, apiKey) {
    const comments = [];
    let pageToken = "";
    try {
      while (comments.length < 500) {
        const response = await fetch(`https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&maxResults=100&pageToken=${pageToken}&key=${apiKey}`);
        const data = await response.json();

        if (!response.ok) {
          const reason = data?.error?.errors?.[0]?.reason || data?.error?.status || "unknown";
          if (response.status === 400 || response.status === 403) {
            await clearStoredKey();
            outputDiv.innerHTML = `<p>API key was rejected by YouTube (${reason}). Please enter a new key.</p>`;
            showSetup();
            return null;
          }
          throw new Error(`YouTube API error: ${reason}`);
        }

        if (data.items) {
          data.items.forEach(item => {
            const commentText = item.snippet.topLevelComment.snippet.textOriginal;
            const timestamp = item.snippet.topLevelComment.snippet.publishedAt;
            const authorId = item.snippet.topLevelComment.snippet.authorChannelId?.value || 'Unknown';
            comments.push({ text: commentText, timestamp: timestamp, authorId: authorId });
          });
        }
        pageToken = data.nextPageToken;
        if (!pageToken) break;
      }
    } catch (error) {
      console.error("Error fetching comments:", error);
      outputDiv.innerHTML += `<p>Error fetching comments: ${error.message}</p>`;
    }
    return comments;
  }

  async function getSentimentPredictions(comments) {
    try {
      const response = await fetch(`${API_URL}/predict_with_timestamps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comments })
      });
      const result = await response.json();
      if (response.ok) return result;
      throw new Error(result.error || 'Error fetching predictions');
    } catch (error) {
      console.error("Error fetching predictions:", error);
      outputDiv.innerHTML += "<p>Error fetching sentiment predictions.</p>";
      return null;
    }
  }

  async function fetchAndDisplayChart(sentimentCounts) {
    await fetchAndDisplayImage(`${API_URL}/generate_chart`, { sentiment_counts: sentimentCounts }, 'chart-container', 'chart image');
  }

  async function fetchAndDisplayWordCloud(comments) {
    await fetchAndDisplayImage(`${API_URL}/generate_wordcloud`, { comments }, 'wordcloud-container', 'word cloud image');
  }

  async function fetchAndDisplayTrendGraph(sentimentData) {
    await fetchAndDisplayImage(`${API_URL}/generate_trend_graph`, { sentiment_data: sentimentData }, 'trend-graph-container', 'trend graph image');
  }

  async function fetchAndDisplayImage(endpoint, body, containerId, label) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) throw new Error(`Failed to fetch ${label}`);
      const blob = await response.blob();
      const img = document.createElement('img');
      img.src = URL.createObjectURL(blob);
      img.style.width = '100%';
      img.style.marginTop = '20px';
      document.getElementById(containerId).appendChild(img);
    } catch (error) {
      console.error(`Error fetching ${label}:`, error);
      outputDiv.innerHTML += `<p>Error fetching ${label}.</p>`;
    }
  }
});

function getStoredKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      resolve(result[STORAGE_KEY] || null);
    });
  });
}

function setStoredKey(key) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: key }, resolve);
  });
}

function clearStoredKey() {
  return new Promise((resolve) => {
    chrome.storage.local.remove([STORAGE_KEY], resolve);
  });
}

async function validateApiKey(apiKey) {
  // Cheap validation: hit the videos endpoint with a known public video ID.
  // The "Me at the zoo" video (jNQXAC9IVRw) is the first YouTube video — extremely unlikely to disappear.
  try {
    const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=id&id=jNQXAC9IVRw&key=${apiKey}`);
    return response.ok;
  } catch {
    return false;
  }
}
