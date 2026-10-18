// Loads (rasterises) every SVG in the manifest; missing files get placeholders.

import { SPRITES, drawPlaceholder, makeProceduralTextures } from './art.js';

export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  preload() {
    this.missing = new Set();
    this.load.on('loaderror', (file) => this.missing.add(file.key));
    for (const [key, [size]] of Object.entries(SPRITES)) {
      this.load.svg(key, `assets/sprites/${key}.svg`, { width: size * 2, height: size * 2 });
    }
  }

  create() {
    for (const [key, [size, color, shape]] of Object.entries(SPRITES)) {
      if (this.missing.has(key) || !this.textures.exists(key)) {
        if (this.textures.exists(key)) this.textures.remove(key);
        drawPlaceholder(this, key, size, color, shape);
      }
    }
    makeProceduralTextures(this);
    this.registry.set('missingArt', [...this.missing]);
    this.scene.start('Game');
  }
}
