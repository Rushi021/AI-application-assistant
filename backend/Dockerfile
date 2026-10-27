FROM python:3.11-slim

# Document rendering dependencies. This image is larger so DOCX and LaTeX
# packets can produce attachable PDFs without host desktop applications.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer fonts-dejavu texlive-latex-base texlive-latex-extra \
    texlive-fonts-recommended && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY alembic.ini .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
