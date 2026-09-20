let img: HTMLImageElement | null = null;
let loaded = false;

export function loadEarthImage(): HTMLImageElement {
  if (!img) {
    img = new Image();
    img.src = `${import.meta.env.BASE_URL}images/earth.jpeg`;
    img.onload = () => { loaded = true; };
  }
  return img;
}

export function isEarthImageLoaded(): boolean {
  return loaded;
}

export function getEarthImage(): HTMLImageElement | null {
  return loaded ? img : null;
}
