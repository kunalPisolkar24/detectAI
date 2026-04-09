function readField(value, names) {
  for (const name of names) {
    if (value && value[name] !== undefined && value[name] !== null) {
      return value[name];
    }
  }

  return undefined;
}

export function getModelName(value) {
  return readField(value, ["modelName", "model_name"]);
}

export function getLabel(value) {
  return readField(value, ["label"]);
}

export function getIsAiGenerated(value) {
  return readField(value, ["isAiGenerated", "is_ai_generated"]);
}

export function getConfidenceScore(value) {
  return readField(value, ["confidenceScore", "confidence_score"]);
}

export function getHumanConfidence(value) {
  return readField(value, ["humanConfidence", "human_confidence"]);
}

export function getAiConfidence(value) {
  return readField(value, ["aiConfidence", "ai_confidence"]);
}

export function hasPredictionResult(value) {
  return Boolean(value && getModelName(value));
}

export function hasValidPredictionLabel(value) {
  const label = getLabel(value);
  return label === "AI" || label === "Human";
}

export function hasBoundedPredictionConfidence(value) {
  const confidence = getConfidenceScore(value);
  return Number.isFinite(confidence) && confidence >= 0 && confidence <= 100;
}
