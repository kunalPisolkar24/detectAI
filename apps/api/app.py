import os
os.environ['TF_USE_LEGACY_KERAS'] = '0'

from flask import Flask, request, jsonify
from flask_cors import CORS
import pickle
import numpy as np
import tensorflow as tf
from tensorflow import keras # type: ignore
from transformers import BertTokenizer, TFBertForSequenceClassification

from dotenv import load_dotenv
import os
load_dotenv()

app = Flask(__name__)
# Configure CORS with specific origins and options
CORS(app, resources={r"/*": {
    "origins": "*",
    "methods": ["GET", "POST", "OPTIONS"],
    "allow_headers": ["Content-Type", "Authorization"]
}})

@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

# Load the Sequential model and tokenizer
with open('sequential_resources/tfidf_tokenizer.pkl', 'rb') as f:
    tfidf_tokenizer = pickle.load(f)

loaded_model = keras.models.load_model('sequential_resources/text_classification_model.h5')

# Load the BERT tokenizer and model
bert_tokenizer = BertTokenizer.from_pretrained('./bert_resources/bert_tokenizer')
bert_model = TFBertForSequenceClassification.from_pretrained('./bert_resources/bert_text_classification_model')

@app.route('/predict/sequential', methods=['POST', 'OPTIONS'])
def predict_sequential():
    if request.method == 'OPTIONS':
        return '', 200
        
    data = request.json
    text = data.get('text') # type: ignore
    
    if not text or not text.strip():
        return jsonify({'error': 'No text provided'}), 400
    
    text_features = tfidf_tokenizer.transform([text])
    # Convert sparse matrix to array if needed
    if hasattr(text_features, 'toarray'):
        text_features = text_features.toarray()
    
    predictions = loaded_model.predict(text_features)
    predicted_label = int(predictions[0][0])
    
    return jsonify({
        'model': 'sequential',
        'predicted_label': predicted_label
    })
    
@app.route('/predict/bert', methods=['POST', 'OPTIONS'])
def predict_bert():
    if request.method == 'OPTIONS':
        return '', 200
        
    data = request.json
    text = data.get('text') # type: ignore
    
    if not text or not text.strip():
        return jsonify({'error': 'No text provided'}), 400
    
    # Tokenize the input text
    inputs = bert_tokenizer(
        text,
        padding=True,
        truncation=True,
        max_length=128,
        return_tensors="tf"
    )
    
    # Make prediction
    predictions = bert_model.predict({'input_ids': inputs['input_ids'], 'attention_mask': inputs['attention_mask']}) # type:ignore
    
    predicted_label = int(tf.argmax(predictions.logits, axis=1).numpy()[0])
    
    return jsonify({
        'model': 'bert',
        'predicted_label': predicted_label
    })

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'Flask Endpoint is Working'}), 200

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)