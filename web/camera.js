import { TILE_SIZE, WORLD_HEIGHT, WORLD_WIDTH } from './constants.js';

export class Camera {
  constructor(width, height) { this.width = width; this.height = height; this.x = 0; this.y = 0; }
  follow(player, dt) {
    const targetX = Math.max(0, Math.min(WORLD_WIDTH * TILE_SIZE - this.width, player.x + player.width / 2 - this.width * .46));
    const targetY = Math.max(0, Math.min(WORLD_HEIGHT * TILE_SIZE - this.height, player.y + player.height / 2 - this.height * .56));
    this.x += (targetX - this.x) * Math.min(1, dt * 6);
    this.y += (targetY - this.y) * Math.min(1, dt * 5);
  }
  reset() { this.x = this.y = 0; }
}
