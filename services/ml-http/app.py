import os
import pickle
from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
from tensorflow.keras.models import load_model
import torch
from transformers import BertForSequenceClassification, BertTokenizer

app = Flask(__name__)
CORS(app, resources={r"/*": {
    "origins": "*",
    "methods": ["GET", "POST", "OPTIONS"],
    "allow_headers": ["Content-Type", "Authorization"]
}})

SEQUENTIAL_MODEL_PATH = 'detect-ai-base/text_classification_model_retrained.h5'
SEQUENTIAL_TOKENIZER_PATH = 'detect-ai-base/tfidf_vectorizer_retrained.pkl'

sequential_model = load_model(SEQUENTIAL_MODEL_PATH)
with open(SEQUENTIAL_TOKENIZER_PATH, 'rb') as f:
    tfidf_tokenizer = pickle.load(f)

BERT_MODEL_PATH = './detect-ai-supreme'
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

bert_model = BertForSequenceClassification.from_pretrained(BERT_MODEL_PATH)
bert_tokenizer = BertTokenizer.from_pretrained(BERT_MODEL_PATH)

bert_model.to(device)
bert_model.eval()

@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

@app.route('/predict/sequential', methods=['POST', 'OPTIONS'])
def predict_sequential():
    if request.method == 'OPTIONS':
        return '', 200
        
    data = request.get_json()
    text = data.get('text')
    
    if not text or not text.strip():
        return jsonify({'error': 'No text provided'}), 400
    
    vectorized_text = tfidf_tokenizer.transform([text]).toarray()
    prediction_prob = sequential_model.predict(vectorized_text)[0][0]
    
    if prediction_prob > 0.5:
        predicted_label = 1
        confidence = float(prediction_prob)
    else:
        predicted_label = 0
        confidence = float(1 - prediction_prob)
        
    return jsonify({
        'model': 'sequential',
        'predicted_label': predicted_label,
        'confidence': confidence
    })
    
@app.route('/predict/bert', methods=['POST', 'OPTIONS'])
def predict_bert():
    if request.method == 'OPTIONS':
        return '', 200
        
    data = request.get_json()
    text = data.get('text')
    
    if not text or not text.strip():
        return jsonify({'error': 'No text provided'}), 400
    
    inputs = bert_tokenizer(text, return_tensors="pt", padding=True, truncation=True, max_length=256)
    inputs = {key: val.to(device) for key, val in inputs.items()}

    with torch.no_grad():
        outputs = bert_model(**inputs)

    logits = outputs.logits
    probabilities = torch.nn.functional.softmax(logits, dim=-1)
    
    predicted_class = torch.argmax(probabilities, dim=-1).item()
    
    return jsonify({
        'model': 'bert',
        'predicted_label': predicted_class,
        'probability_human': probabilities[0][0].item(),
        'probability_ai': probabilities[0][1].item()
    })

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'Flask Endpoint is Working'}), 200

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)