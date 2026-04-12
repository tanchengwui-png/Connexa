export function extractCoordinatesFromMapLink(value: string) {
  const input = value.trim();

  if (!input) {
    return null;
  }

  const atMatch = input.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (atMatch) {
    return {
      latitude: atMatch[1],
      longitude: atMatch[2]
    };
  }

  const llMatch = input.match(/[?&]ll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (llMatch) {
    return {
      latitude: llMatch[1],
      longitude: llMatch[2]
    };
  }

  const qMatch = input.match(/[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (qMatch) {
    return {
      latitude: qMatch[1],
      longitude: qMatch[2]
    };
  }

  const wazeMatch = input.match(/[?&]ll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (wazeMatch) {
    return {
      latitude: wazeMatch[1],
      longitude: wazeMatch[2]
    };
  }

  return null;
}

export function detectMapLinkProvider(value: string) {
  const normalized = value.toLowerCase();

  if (normalized.includes("waze.com")) {
    return "Waze";
  }

  if (normalized.includes("google.") || normalized.includes("maps.app.goo.gl")) {
    return "Google Maps";
  }

  return "Map";
}
