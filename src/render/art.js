// Sprite manifest. Each SVG in assets/sprites/ is rasterised at 2x its world size at boot
// and drawn at scale 0.5 (crisp at camera zoom 1.5). A missing file gets a placeholder,
// so art can be added at any time without breaking the game.
//
// key: [world size in px, placeholder colour, placeholder shape]

export const SPRITES = {
  // Heroes (viewBox 128)
  h_brutus: [72, 0x3f7d3a, 'rex'], h_fern: [64, 0x8fd16a, 'rex'], h_spike: [64, 0xf08a24, 'rex'], h_sparky: [64, 0x6b6fe0, 'rex'],
  h_pip: [64, 0xf06aa0, 'rex'], h_goldie: [64, 0xe8b830, 'rex'], h_bolt: [64, 0x2fb5a8, 'rex'], h_ash: [64, 0x5a4a52, 'rex'],
  // Enemies (small viewBox 64, big 192, boss 256)
  e_raptor: [60, 0xa8432a, 'blob'], e_spitter: [64, 0x7c8a3a, 'blob'], e_caveman: [64, 0xc9a26b, 'blob'],
  e_mosquito: [34, 0x5a2a4a, 'blob'], e_ptero: [72, 0x7a6a8a, 'blob'], e_ankylo: [104, 0x8a8a84, 'blob'],
  e_spino: [150, 0x2f6f6a, 'blob'], e_trike: [200, 0xd8c8a0, 'blob'], e_bush: [64, 0x4f8f3a, 'bush'],
  // Weapons (viewBox 64)
  w_stone_axe: [36, 0x9a8a7a, 'stick'], w_bone_club: [38, 0xeee2c8, 'stick'], w_tail_spike: [36, 0xb0a090, 'stick'],
  w_slingshot: [32, 0x8a5a3a, 'stick'], w_spear_thrower: [38, 0x7a5a3a, 'stick'], w_bone_bow: [36, 0xeee2c8, 'stick'],
  w_lava_lobber: [36, 0x8a3a2a, 'stick'], w_ember_staff: [38, 0xd8662a, 'stick'], w_ptero_pal: [34, 0x7a6a8a, 'stick'],
  w_egg_turret: [34, 0xf0e8d0, 'stick'], w_coconut_bomb: [32, 0x7a5030, 'stick'], w_amber_laser: [34, 0xffb627, 'stick'],
  // Projectiles (viewBox 32)
  p_pebble: [14, 0xd8d0c0, 'dot'], p_spear: [34, 0xc0a070, 'dart'], p_arrow: [30, 0xeee2c8, 'dart'],
  p_lava: [22, 0xff6a2a, 'dot'], p_ember: [18, 0xffa040, 'dot'], p_coconut: [22, 0x7a5030, 'dot'],
  p_spike: [22, 0xb0a090, 'dart'], p_egg: [14, 0xfff4dc, 'dot'],
  // Summons
  s_turret: [44, 0xf0e8d0, 'blob'], s_ptero: [44, 0x9a8aaa, 'blob'],
  // Pickups (viewBox 32; the loot crate is drawn at viewBox 64)
  amber: [22, 0xffb627, 'gem'], berry: [24, 0xd03a5a, 'dot'], crate: [42, 0xb98a4a, 'box'],
  // Arena props (viewBox 64)
  rock1: [80, 0x7a7068, 'rock'], rock2: [70, 0x6a6058, 'rock'], rock3: [90, 0x5a4a44, 'rock'],
  pebbles: [40, 0xa89a72, 'dot'], fern: [56, 0x8a9a5a, 'bush'],
};

export const PLAYER_COLORS = [0x3ee0e8, 0xffd23a, 0xff6fb5, 0x9be33c];
export const PLAYER_COLORS_CSS = ['#3ee0e8', '#ffd23a', '#ff6fb5', '#9be33c'];
export const OUTLINE = 0x2b2118;

/** Draw a placeholder texture for a sprite whose SVG is missing. */
export function drawPlaceholder(scene, key, size, color, shape) {
  const s = size * 2;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const lw = Math.max(3, s * 0.06);
  g.lineStyle(lw, OUTLINE, 1);
  g.fillStyle(color, 1);
  const c = s / 2;
  if (shape === 'rex') {
    g.fillCircle(c - s * 0.05, c + s * 0.12, s * 0.3); g.strokeCircle(c - s * 0.05, c + s * 0.12, s * 0.3);
    g.fillCircle(c + s * 0.12, c - s * 0.15, s * 0.24); g.strokeCircle(c + s * 0.12, c - s * 0.15, s * 0.24);
    g.fillStyle(0xffffff, 1); g.fillCircle(c + s * 0.2, c - s * 0.2, s * 0.06);
    g.fillStyle(OUTLINE, 1); g.fillCircle(c + s * 0.22, c - s * 0.2, s * 0.03);
  } else if (shape === 'stick') {
    g.fillRoundedRect(c - s * 0.08, s * 0.15, s * 0.16, s * 0.7, s * 0.06); g.strokeRoundedRect(c - s * 0.08, s * 0.15, s * 0.16, s * 0.7, s * 0.06);
    g.fillCircle(c, s * 0.25, s * 0.16); g.strokeCircle(c, s * 0.25, s * 0.16);
  } else if (shape === 'dart') {
    g.fillRoundedRect(s * 0.1, c - s * 0.08, s * 0.8, s * 0.16, s * 0.06); g.strokeRoundedRect(s * 0.1, c - s * 0.08, s * 0.8, s * 0.16, s * 0.06);
  } else if (shape === 'gem') {
    g.fillPoints([{ x: c, y: s * 0.08 }, { x: s * 0.88, y: c }, { x: c, y: s * 0.92 }, { x: s * 0.12, y: c }], true);
    g.strokePoints([{ x: c, y: s * 0.08 }, { x: s * 0.88, y: c }, { x: c, y: s * 0.92 }, { x: s * 0.12, y: c }], true);
  } else if (shape === 'box') {
    g.fillRoundedRect(s * 0.12, s * 0.2, s * 0.76, s * 0.62, s * 0.08); g.strokeRoundedRect(s * 0.12, s * 0.2, s * 0.76, s * 0.62, s * 0.08);
    g.lineBetween(s * 0.12, s * 0.5, s * 0.88, s * 0.5);
  } else if (shape === 'rock') {
    g.fillEllipse(c, c + s * 0.05, s * 0.86, s * 0.66); g.strokeEllipse(c, c + s * 0.05, s * 0.86, s * 0.66);
  } else if (shape === 'bush') {
    for (const [dx, dy] of [[-0.2, 0.1], [0.2, 0.1], [0, -0.1]]) { g.fillCircle(c + dx * s, c + dy * s, s * 0.24); g.strokeCircle(c + dx * s, c + dy * s, s * 0.24); }
  } else {
    g.fillCircle(c, c, s * 0.4); g.strokeCircle(c, c, s * 0.4);
    if (shape === 'blob') { g.fillStyle(0xffffff, 1); g.fillCircle(c + s * 0.15, c - s * 0.1, s * 0.08); g.fillStyle(OUTLINE, 1); g.fillCircle(c + s * 0.17, c - s * 0.1, s * 0.04); }
  }
  g.generateTexture(key, s, s);
  g.destroy();
}

/** Procedural textures used by the renderer (rings, shadows, shots, particles, ground). */
export function makeProceduralTextures(scene) {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  // Soft shadow
  g.clear(); g.fillStyle(0x000000, 0.22); g.fillEllipse(64, 24, 120, 40); g.generateTexture('shadow', 128, 48);
  // Player ring (white; tinted per player)
  g.clear(); g.lineStyle(10, 0xffffff, 1); g.strokeEllipse(64, 32, 112, 48); g.generateTexture('ring', 128, 64);
  // Enemy shot: magenta with dark outline
  g.clear(); g.fillStyle(0x2b2118, 1); g.fillCircle(32, 32, 30); g.fillStyle(0xff2fd1, 1); g.fillCircle(32, 32, 22); g.fillStyle(0xffb8f0, 1); g.fillCircle(25, 25, 7);
  g.generateTexture('shot', 64, 64);
  // Particles
  g.clear(); g.fillStyle(0xffffff, 1); g.fillCircle(8, 8, 8); g.generateTexture('dot', 16, 16);
  g.clear(); g.fillStyle(0xffffff, 1); g.fillRect(0, 0, 4, 4); g.generateTexture('px', 4, 4);
  // Ground tile: two muted tones in a soft checker with sparse specks
  g.clear();
  g.fillStyle(0xcbb98a, 1); g.fillRect(0, 0, 256, 256);
  g.fillStyle(0xc4b283, 1); g.fillRect(0, 0, 128, 128); g.fillRect(128, 128, 128, 128);
  g.fillStyle(0xb8a676, 0.5);
  for (const [x, y, r] of [[30, 40, 3], [90, 170, 2], [200, 60, 3], [160, 220, 2], [60, 120, 2], [230, 150, 3]]) g.fillCircle(x, y, r);
  g.generateTexture('ground', 256, 256);
  g.destroy();
}
