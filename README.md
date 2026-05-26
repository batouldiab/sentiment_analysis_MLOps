# YouTube Sentiment Insights — Sentiment Analysis MLOps

An end-to-end **MLOps pipeline** that classifies YouTube comments as **Positive**, **Neutral**, or **Negative**, and surfaces the results to users through a **Chrome extension** that overlays sentiment insights directly on the YouTube watch page.

The project demonstrates a full ML lifecycle: data ingestion → preprocessing → feature engineering → model training → evaluation & tracking → model registry → containerized serving → CI/CD to AWS.

---

## Architecture

```
                  ┌───────────────────────┐
                  │  Reddit_Data.csv      │  (labeled sentiment corpus)
                  └──────────┬────────────┘
                             │
       ┌─────────────────────▼─────────────────────┐
       │           DVC Pipeline (dvc.yaml)         │
       │  ingest → preprocess → train → evaluate   │
       │                  → register               │
       └─────────────┬─────────────────┬───────────┘
                     │                 │
              lgbm_model.pkl      MLflow Tracking
              tfidf_vectorizer.pkl  & Model Registry
                     │
       ┌─────────────▼─────────────┐
       │   Flask API (app.py)      │  ←── Dockerized → AWS ECR → ECS/EC2
       │  /predict, /chart, ...    │
       └─────────────┬─────────────┘
                     │ HTTP
       ┌─────────────▼─────────────┐
       │  Chrome Extension (MV3)   │  YouTube Data API → comments
       │  popup.html / popup.js    │  Renders charts, wordcloud, trends
       └───────────────────────────┘
```

---

## Tech Stack

| Layer            | Tools                                                              |
|------------------|--------------------------------------------------------------------|
| Language         | Python 3.11                                                        |
| ML / NLP         | LightGBM, scikit-learn (TF-IDF), NLTK (stopwords, WordNet lemmatizer) |
| Pipeline / DVC   | DVC 3.x with S3 remote                                             |
| Tracking         | MLflow (tracking server + Model Registry)                          |
| Serving          | Flask + Flask-CORS                                                 |
| Visualization    | matplotlib, seaborn, wordcloud                                     |
| Frontend         | Chrome Extension (Manifest V3, vanilla JS)                         |
| Container / Cloud| Docker, AWS ECR, AWS EC2 (self-hosted runner), GitHub Actions      |

---

## Project Structure

```
sentiment_analysis_MLOps/
├── src/
│   ├── data/
│   │   ├── data_ingestion.py        # load CSV, dedupe, train/test split
│   │   └── data_preprocessing.py    # clean, stopword removal, lemmatize
│   └── model/
│       ├── model_building.py        # TF-IDF + LightGBM training
│       ├── model_evaluation.py      # metrics, confusion matrix → MLflow
│       └── register_model.py        # promote to MLflow Model Registry (Staging)
├── flask_app/
│   └── app.py                       # REST API: /predict, /generate_chart, ...
├── yt-chrome-plugin-frontend/
│   ├── manifest.json                # Chrome extension manifest (MV3)
│   ├── popup.html                   # extension UI
│   └── popup.js                     # YouTube API + Flask backend integration
├── notebooks experiments/           # EDA + baseline/HPT experiments
├── .github/workflows/cicd.yaml      # CI/CD: build → push ECR → deploy
├── Dockerfile
├── dvc.yaml                         # pipeline stages
├── params.yaml                      # hyperparameters
├── requirements.txt
├── setup.py
├── lgbm_model.pkl                   # trained model artifact
└── tfidf_vectorizer.pkl             # fitted vectorizer artifact
```

---

## Pipeline Stages

The DVC pipeline ([dvc.yaml](dvc.yaml)) is composed of the following stages:

1. **`data_ingestion`** — Reads `Reddit_Data.csv`, drops nulls/duplicates/empty comments, performs an 80/20 train/test split, writes to `data/raw/`.
2. **`data_preprocessing`** — Lowercases, strips punctuation, removes English stopwords (keeping sentiment-bearing ones: *not, but, however, no, yet*), lemmatizes with WordNet. Writes to `data/interim/`.
3. **`model_building`** — Fits a **TF-IDF vectorizer** (ngrams 1–3, 1000 features) and trains a **LightGBM** multiclass classifier (3 classes, class-balanced with L1/L2 regularization). Produces `lgbm_model.pkl` and `tfidf_vectorizer.pkl`.
4. **`model_evaluation`** *(currently commented in dvc.yaml)* — Computes classification report + confusion matrix, logs everything (params, metrics, model with signature, vectorizer artifact) to MLflow, and writes `experiment_info.json`.
5. **`model_registration`** — Registers the run to the MLflow Model Registry as `yt_chrome_plugin_model` and transitions it to **Staging**.

Hyperparameters live in [params.yaml](params.yaml):

```yaml
data_ingestion:
  test_size: 0.20

model_building:
  ngram_range: [1, 3]
  max_features: 1000
  learning_rate: 0.09
  max_depth: 20
  n_estimators: 367
```

---

## Setup

### Prerequisites
- Python 3.11
- Docker (optional, for containerized serving)
- An MLflow tracking server (the code expects one at a configurable URI)
- AWS credentials if you want to use the S3 DVC remote or push to ECR

### Install

```bash
git clone https://github.com/<your-username>/sentiment_analysis_MLOps.git
cd sentiment_analysis_MLOps

python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate

pip install -r requirements.txt
pip install -e .
```

### Configure MLflow

The MLflow tracking URI is currently hardcoded in `src/model/model_evaluation.py` and `src/model/register_model.py`. Update both to point at your own tracking server before running the evaluation/registration stages.

---

## Running the Pipeline

Reproduce the full pipeline end-to-end with DVC:

```bash
dvc repro
```

Run individual stages:

```bash
python src/data/data_ingestion.py
python src/data/data_preprocessing.py
python src/model/model_building.py
python src/model/model_evaluation.py
python src/model/register_model.py
```

---

## Running the Serving API

### Locally

```bash
cd flask_app
python app.py
```

The API will be available at `http://127.0.0.1:5000/`.

### With Docker

```bash
docker build -t yt-sentiment .
docker run -p 5000:5000 yt-sentiment
```

### Endpoints

| Method | Endpoint                    | Description                                                          |
|--------|-----------------------------|----------------------------------------------------------------------|
| GET    | `/`                         | Health check                                                         |
| POST   | `/predict`                  | Returns sentiment for a list of comments                             |
| POST   | `/predict_with_timestamps`  | Same as `/predict`, but also returns the original timestamps         |
| POST   | `/generate_chart`           | Returns a PNG pie chart of sentiment distribution                    |
| POST   | `/generate_wordcloud`       | Returns a PNG wordcloud of the input comments                        |
| POST   | `/generate_trend_graph`     | Returns a PNG line plot of monthly sentiment percentages             |

Example:

```bash
curl -X POST http://127.0.0.1:5000/predict \
  -H "Content-Type: application/json" \
  -d '{"comments": ["This video was amazing!", "Worst content ever", "It was ok"]}'
```

---

## Chrome Extension

The [`yt-chrome-plugin-frontend/`](yt-chrome-plugin-frontend/) directory contains a Manifest V3 Chrome extension that:

1. Detects the active YouTube watch page and extracts the video ID.
2. Fetches up to **500 top-level comments** via the **YouTube Data API v3**.
3. Sends comments to the Flask API for sentiment predictions.
4. Renders a dark-themed dashboard inside the popup:
   - Summary metrics (total comments, unique commenters, avg length, avg sentiment score)
   - Pie chart of sentiment distribution
   - Monthly sentiment trend graph
   - Wordcloud
   - Top 25 comments with predicted sentiments

### Install (developer mode)

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `yt-chrome-plugin-frontend/` directory
4. Add your own **YouTube Data API v3 key** in `popup.js` (`API_KEY` constant)
5. Make sure the Flask API is reachable at the `API_URL` set in `popup.js`

---

## CI/CD

The GitHub Actions workflow in [`.github/workflows/cicd.yaml`](.github/workflows/cicd.yaml) is triggered on every push to `main` and:

1. **Continuous Integration** — placeholder lint + unit-test steps
2. **Continuous Delivery** — builds the Docker image and pushes it to **AWS ECR**
3. **Continuous Deployment** — a self-hosted runner pulls the latest image, stops the old container, and runs the new one

Required GitHub secrets:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `AWS_ECR_LOGIN_URI`
- `ECR_REPOSITORY_NAME`

---

## Dataset

The training corpus is `Reddit_Data.csv`, a labeled sentiment dataset with two columns:

- `clean_comment` — the comment text
- `category` — sentiment label: `-1` (Negative), `0` (Neutral), `1` (Positive)

Exploratory analysis and experimentation notebooks live in [`notebooks experiments/`](notebooks%20experiments/), including:
- `Preprocessing_EDA.ipynb`
- `baseline_model.ipynb`
- `bow_tfidf.ipynb`
- `handling_imbalanced_data.ipynb`
- `lightgbm_detailed_hpt.ipynb`
- `xgboost_with_hpt.ipynb`
- `stacking.ipynb`

---

## Known Issues / TODO

- `requirements.txt` is currently saved as UTF-16 and needs to be re-saved as UTF-8 for `pip install -r` to work reliably.
- The `Dockerfile` runs `python3 app.py` from `/app`, but `app.py` lives in `flask_app/app.py`. The `CMD` (or `WORKDIR`) needs to be updated.
- The MLflow tracking URI is hardcoded across multiple files — move it to an environment variable or `params.yaml`.
- The `model_evaluation` stage is commented out in `dvc.yaml`, but `model_registration` depends on `experiment_info.json` produced by it. Re-enable evaluation before running `dvc repro`.
- The YouTube Data API key in `popup.js` should be moved out of source control.

---

## Author

**Batoul** — batoul96diab@gmail.com
