import { getRuntimeConfig } from "../config.js";
import * as http from "./http.js";
import * as grpc from "./grpc.js";

const config = getRuntimeConfig();
const active = config.protocol === "grpc" ? grpc : http;

export const protocolTag = config.protocol;

export function request(args) {
  return active.request(args);
}

export function healthCheck(args) {
  return http.healthCheck(args);
}
