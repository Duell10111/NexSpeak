import { HOMESERVER_URL, JWT_SERVICE_URL } from "./helpers"

export default async function globalSetup() {
  for (const [name, url] of [
    ["Synapse", `${HOMESERVER_URL}/health`],
    ["lk-jwt-service", `${JWT_SERVICE_URL}/healthz`],
  ]) {
    try {
      await fetch(url)
    } catch {
      throw new Error(`${name} is not reachable (${url}). Start it first: docker compose -f dev/docker-compose.yml up -d`)
    }
  }
}
