const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const HALF_W = WIDTH / 2;
const HALF_H = HEIGHT / 2;

const keys = new Set();
let lastHorizontalKey = null;
let lastVerticalKey = null;
let lastTime = performance.now();
let cardHitboxes = [];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rand = (min, max) => Math.random() * (max - min) + min;
const distance = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

const state = {};

function resetGame() {
  state.player = {
    x: 0,
    y: 0,
    radius: 16,
    speed: 340,
    hp: 18,
    maxHp: 18,
    invuln: 0,
    flash: 0,
    pickupRadius: 200,
  };

  state.combat = {
    projectileCooldown: 0.32,
    projectileSpeed: 700,
    projectileDamage: 3,
    projectileRadius: 6,
    projectileCount: 1,
    meleeCooldown: 0.95,
    meleeRadius: 86,
    meleeDamage: 4,
    meleeFlash: 0,
    chainCooldown: 2.3,
    chainDamage: 5,
    chainTargets: 4,
    chainRadius: 160,
    chainBlastRadius: 56,
    burstCooldown: 4.3,
    burstDamage: 6,
    burstRadius: 98,
    meteorCooldown: 5.7,
    meteorDamage: 7,
    meteorRadius: 88,
    meteorCount: 2,
    potionDropRate: 0.18,
  };

  state.timers = {
    spawn: 0,
    projectile: 0,
    melee: 0,
    chain: 0,
    burst: 0,
    meteor: 0,
  };

  state.progress = {
    level: 1,
    xp: 0,
    xpToNext: 7,
    pendingLevelUps: 0,
    kills: 0,
    time: 0,
  };

  state.flags = {
    gameOver: false,
    levelUp: false,
  };

  state.entities = {
    enemies: [],
    projectiles: [],
    gems: [],
    potions: [],
    texts: [],
    bursts: [],
    bolts: [],
  };

  state.upgrades = [];
  state.limits = {
    enemies: 70,
    projectiles: 56,
    texts: 32,
    bursts: 14,
    bolts: 18,
  };
}

function worldToScreen(x, y) {
  return { x: x - state.player.x + HALF_W, y: y - state.player.y + HALF_H };
}

function visibleBounds(padding = 0) {
  return {
    left: state.player.x - HALF_W - padding,
    right: state.player.x + HALF_W + padding,
    top: state.player.y - HALF_H - padding,
    bottom: state.player.y + HALF_H + padding,
  };
}

function inActiveBounds(x, y, padding = 220) {
  const bounds = visibleBounds(padding);
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

function addText(x, y, text, life, color) {
  state.entities.texts.push({ x, y, text, life, color });
  if (state.entities.texts.length > state.limits.texts) {
    state.entities.texts.splice(0, state.entities.texts.length - state.limits.texts);
  }
}

function addBurst(x, y, radius, life, outline, fill = "") {
  state.entities.bursts.push({ x, y, radius, life, maxLife: life, outline, fill });
  if (state.entities.bursts.length > state.limits.bursts) {
    state.entities.bursts.splice(0, state.entities.bursts.length - state.limits.bursts);
  }
}

function addBolt(x1, y1, x2, y2, life, color, width) {
  state.entities.bolts.push({ x1, y1, x2, y2, life, maxLife: life, color, width });
  if (state.entities.bolts.length > state.limits.bolts) {
    state.entities.bolts.splice(0, state.entities.bolts.length - state.limits.bolts);
  }
}

function damageEnemy(enemy, damage, color, originX, originY, knockback = 0) {
  enemy.hp -= damage;
  addText(enemy.x, enemy.y - enemy.radius - 10, String(Math.round(damage)), 0.35, color);
  if (!knockback) return;
  const dx = enemy.x - originX;
  const dy = enemy.y - originY;
  const norm = Math.hypot(dx, dy) || 1;
  enemy.x += (dx / norm) * knockback;
  enemy.y += (dy / norm) * knockback;
}

function enemiesByDistance(maxDistance = Infinity) {
  return state.entities.enemies
    .map((enemy) => ({ enemy, d: distance(state.player.x, state.player.y, enemy.x, enemy.y) }))
    .filter((item) => item.d <= maxDistance)
    .sort((a, b) => a.d - b.d)
    .map((item) => item.enemy);
}

function nearestEnemy(maxDistance = Infinity) {
  return enemiesByDistance(maxDistance)[0] ?? null;
}

function clusterTarget(searchRadius, maxDistance) {
  const candidates = enemiesByDistance(maxDistance).slice(0, 10);
  let best = null;
  let bestScore = -1;
  for (const enemy of candidates) {
    let score = 0;
    for (const other of state.entities.enemies) {
      if (distance(enemy.x, enemy.y, other.x, other.y) <= searchRadius) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = enemy;
    }
  }
  return best;
}

function spawnEnemy() {
  const side = Math.floor(Math.random() * 4);
  const marginX = HALF_W + 120;
  const marginY = HALF_H + 120;
  let x;
  let y;

  if (side === 0) {
    x = state.player.x + rand(-HALF_W, HALF_W);
    y = state.player.y - marginY;
  } else if (side === 1) {
    x = state.player.x + marginX;
    y = state.player.y + rand(-HALF_H, HALF_H);
  } else if (side === 2) {
    x = state.player.x + rand(-HALF_W, HALF_W);
    y = state.player.y + marginY;
  } else {
    x = state.player.x - marginX;
    y = state.player.y + rand(-HALF_H, HALF_H);
  }

  const tier = Math.min(4, Math.floor(state.progress.time / 24));
  const roll = Math.random();
  if (roll < 0.58) {
    state.entities.enemies.push({ x, y, radius: 14 + tier, speed: 74 + tier * 5, hp: 4 + tier, maxHp: 4 + tier, damage: 1, kind: "slime", xp: 1 });
  } else if (roll < 0.86) {
    state.entities.enemies.push({ x, y, radius: 12 + tier, speed: 118 + tier * 7, hp: 3 + tier, maxHp: 3 + tier, damage: 1, kind: "beast", xp: 1 });
  } else {
    state.entities.enemies.push({ x, y, radius: 20 + tier * 1.4, speed: 64 + tier * 4, hp: 8 + tier * 2.5, maxHp: 8 + tier * 2.5, damage: 1, kind: "demon", xp: 2 });
  }
}

function gainXp(value) {
  state.progress.xp += value;
  while (state.progress.xp >= state.progress.xpToNext) {
    state.progress.xp -= state.progress.xpToNext;
    state.progress.level += 1;
    state.progress.xpToNext = Math.floor(state.progress.xpToNext * 1.35) + 3;
    state.progress.pendingLevelUps += 1;
  }
  if (state.progress.pendingLevelUps > 0 && !state.flags.levelUp) {
    openLevelUp();
  }
}

function openLevelUp() {
  state.flags.levelUp = true;
  const pool = [
    { title: "Rapid Fire", desc: "Blessed bolt cooldown -12%", apply: () => (state.combat.projectileCooldown = Math.max(0.12, state.combat.projectileCooldown * 0.88)) },
    { title: "Heavy Shots", desc: "Blessed bolt damage +1", apply: () => (state.combat.projectileDamage += 1) },
    { title: "Multi Shot", desc: "Blessed bolt +1", apply: () => (state.combat.projectileCount = Math.min(5, state.combat.projectileCount + 1)) },
    { title: "Fleet Footed", desc: "Move speed +24", apply: () => (state.player.speed += 24) },
    { title: "Vitality", desc: "Max HP +4 and heal 4", apply: () => { state.player.maxHp += 4; state.player.hp = Math.min(state.player.maxHp, state.player.hp + 4); } },
    { title: "Magnet", desc: "Pickup radius +32", apply: () => (state.player.pickupRadius += 32) },
    { title: "Blade Ring", desc: "Sword arc damage +2 and radius +10", apply: () => { state.combat.meleeDamage += 2; state.combat.meleeRadius += 10; } },
    { title: "Quick Slash", desc: "Sword arc cooldown -14%", apply: () => (state.combat.meleeCooldown = Math.max(0.28, state.combat.meleeCooldown * 0.86)) },
    { title: "Storm Brand", desc: "Lightning damage +2 and +1 jump", apply: () => { state.combat.chainDamage += 2; state.combat.chainTargets = Math.min(7, state.combat.chainTargets + 1); } },
    { title: "Spell Haste", desc: "Magic cooldowns -10%", apply: () => { state.combat.chainCooldown *= 0.9; state.combat.burstCooldown *= 0.9; state.combat.meteorCooldown *= 0.9; } },
    { title: "Sacred Seal", desc: "Sanctify damage +2 and radius +12", apply: () => { state.combat.burstDamage += 2; state.combat.burstRadius += 12; } },
    { title: "Skyfire", desc: "Meteor damage +2, radius +10, +1 strike", apply: () => { state.combat.meteorDamage += 2; state.combat.meteorRadius += 10; state.combat.meteorCount = Math.min(4, state.combat.meteorCount + 1); } },
  ];
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  state.upgrades = shuffled.slice(0, 3);
}

function applyUpgrade(index) {
  const choice = state.upgrades[index];
  if (!choice) return;
  choice.apply();
  state.progress.pendingLevelUps = Math.max(0, state.progress.pendingLevelUps - 1);
  if (state.progress.pendingLevelUps > 0) {
    openLevelUp();
  } else {
    state.flags.levelUp = false;
    state.upgrades = [];
  }
}

function fireProjectiles() {
  if (state.entities.projectiles.length >= state.limits.projectiles) return;
  const target = nearestEnemy();
  const base = target ? Math.atan2(target.y - state.player.y, target.x - state.player.x) : -Math.PI / 2;
  const spread = 0.18;
  for (let i = 0; i < state.combat.projectileCount; i += 1) {
    const offset = (i - (state.combat.projectileCount - 1) / 2) * spread;
    const angle = base + offset;
    state.entities.projectiles.push({
      x: state.player.x,
      y: state.player.y,
      vx: Math.cos(angle) * state.combat.projectileSpeed,
      vy: Math.sin(angle) * state.combat.projectileSpeed,
      radius: state.combat.projectileRadius,
      damage: state.combat.projectileDamage,
      life: 0.95,
    });
  }
}

function performMeleeAttack() {
  let hits = 0;
  for (const enemy of state.entities.enemies) {
    if (distance(state.player.x, state.player.y, enemy.x, enemy.y) <= state.combat.meleeRadius + enemy.radius) {
      damageEnemy(enemy, state.combat.meleeDamage, "#ffd43b", state.player.x, state.player.y, 18);
      hits += 1;
    }
  }
  if (hits) {
    state.combat.meleeFlash = 0.16;
    addText(state.player.x, state.player.y - 48, "Slash!", 0.28, "#ffd43b");
  }
}

function castChainLightning() {
  let current = nearestEnemy(560);
  if (!current) return;
  const used = new Set();
  const hit = new Set();
  let sourceX = state.player.x;
  let sourceY = state.player.y;

  for (let step = 0; step < state.combat.chainTargets && current; step += 1) {
    used.add(current);
    addBolt(sourceX, sourceY, current.x, current.y, 0.16, "#8ce9ff", 4);
    addBurst(current.x, current.y, state.combat.chainBlastRadius, 0.2, "#b2f2ff");

    for (const enemy of state.entities.enemies) {
      if (hit.has(enemy)) continue;
      if (distance(current.x, current.y, enemy.x, enemy.y) <= state.combat.chainBlastRadius + enemy.radius) {
        damageEnemy(enemy, state.combat.chainDamage, "#8ce9ff", current.x, current.y, 12);
        hit.add(enemy);
      }
    }

    let next = null;
    let bestDistance = Infinity;
    for (const enemy of state.entities.enemies) {
      if (used.has(enemy)) continue;
      const d = distance(current.x, current.y, enemy.x, enemy.y);
      if (d <= state.combat.chainRadius && d < bestDistance) {
        bestDistance = d;
        next = enemy;
      }
    }
    sourceX = current.x;
    sourceY = current.y;
    current = next;
  }
}

function castSanctify() {
  const target = clusterTarget(state.combat.burstRadius * 1.15, 560);
  if (!target) return;
  addBurst(target.x, target.y, state.combat.burstRadius, 0.28, "#ffe066", "rgba(255, 243, 191, 0.25)");
  for (const enemy of state.entities.enemies) {
    if (distance(target.x, target.y, enemy.x, enemy.y) <= state.combat.burstRadius + enemy.radius) {
      damageEnemy(enemy, state.combat.burstDamage, "#ffe066", target.x, target.y, 24);
    }
  }
}

function castMeteor() {
  const candidates = enemiesByDistance(660).slice(0, 6);
  if (!candidates.length) return;
  const shuffled = [...candidates].sort(() => Math.random() - 0.5).slice(0, state.combat.meteorCount);
  for (const target of shuffled) {
    const strikeX = target.x + rand(-18, 18);
    const strikeY = target.y + rand(-18, 18);
    addBolt(strikeX - 24, strikeY - state.combat.meteorRadius - 100, strikeX, strikeY, 0.18, "#ff922b", 5);
    addBurst(strikeX, strikeY, state.combat.meteorRadius, 0.3, "#ff922b", "rgba(255, 232, 161, 0.26)");
    for (const enemy of state.entities.enemies) {
      if (distance(strikeX, strikeY, enemy.x, enemy.y) <= state.combat.meteorRadius + enemy.radius) {
        damageEnemy(enemy, state.combat.meteorDamage, "#ff922b", strikeX, strikeY, 28);
      }
    }
  }
}

function resolveAxis(negative, positive, preferred) {
  const negPressed = negative.some((key) => keys.has(key));
  const posPressed = positive.some((key) => keys.has(key));
  if (negPressed && posPressed) {
    if (negative.includes(preferred)) return -1;
    if (positive.includes(preferred)) return 1;
    return 0;
  }
  if (negPressed) return -1;
  if (posPressed) return 1;
  return 0;
}

function updateMovement(dt) {
  const moveX = resolveAxis(["a", "arrowleft"], ["d", "arrowright"], lastHorizontalKey);
  const moveY = resolveAxis(["w", "arrowup"], ["s", "arrowdown"], lastVerticalKey);
  if (!moveX && !moveY) return;
  const norm = Math.hypot(moveX, moveY) || 1;
  const speed = state.player.speed * dt;
  state.player.x += (moveX / norm) * speed;
  state.player.y += (moveY / norm) * speed;
}

function updateProjectiles(dt) {
  const survivors = [];
  for (const projectile of state.entities.projectiles) {
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;
    projectile.life -= dt;
    if (projectile.life <= 0 || !inActiveBounds(projectile.x, projectile.y, 250)) continue;

    let hitTarget = false;
    for (const enemy of state.entities.enemies) {
      if (distance(projectile.x, projectile.y, enemy.x, enemy.y) <= projectile.radius + enemy.radius) {
        damageEnemy(enemy, projectile.damage, "#fff3bf", state.player.x, state.player.y);
        hitTarget = true;
        break;
      }
    }
    if (!hitTarget) survivors.push(projectile);
  }
  state.entities.projectiles = survivors;
}

function updateEnemies(dt) {
  const survivors = [];
  for (const enemy of state.entities.enemies) {
    const dx = state.player.x - enemy.x;
    const dy = state.player.y - enemy.y;
    const norm = Math.hypot(dx, dy) || 1;
    enemy.x += (dx / norm) * enemy.speed * dt;
    enemy.y += (dy / norm) * enemy.speed * dt;

    if (enemy.hp <= 0) {
      state.progress.kills += 1;
      state.entities.gems.push({ x: enemy.x, y: enemy.y, value: enemy.xp, radius: 8 });
      if (Math.random() < state.combat.potionDropRate) {
        state.entities.potions.push({ x: enemy.x + rand(-10, 10), y: enemy.y + rand(-10, 10), heal: enemy.xp === 1 ? 4 : 7, radius: 10 });
      }
      continue;
    }

    if (distance(state.player.x, state.player.y, enemy.x, enemy.y) <= state.player.radius + enemy.radius && state.player.invuln <= 0) {
      state.player.hp -= enemy.damage;
      state.player.invuln = 0.85;
      state.player.flash = 0.16;
      enemy.x -= (dx / norm) * 24;
      enemy.y -= (dy / norm) * 24;
      if (state.player.hp <= 0) {
        state.flags.gameOver = true;
      }
    }

    if (inActiveBounds(enemy.x, enemy.y, 260)) survivors.push(enemy);
  }
  state.entities.enemies = survivors;
}

function updatePickups(dt) {
  const nextGems = [];
  for (const gem of state.entities.gems) {
    let d = distance(gem.x, gem.y, state.player.x, state.player.y);
    if (d <= state.player.pickupRadius) {
      const dx = state.player.x - gem.x;
      const dy = state.player.y - gem.y;
      const norm = Math.hypot(dx, dy) || 1;
      const step = Math.min(d, Math.max(140, 520 - d) * dt);
      gem.x += (dx / norm) * step;
      gem.y += (dy / norm) * step;
      d = distance(gem.x, gem.y, state.player.x, state.player.y);
    }

    if (d <= state.player.radius + gem.radius + 3) {
      gainXp(gem.value);
      addText(state.player.x, state.player.y - 30, `+${gem.value} xp`, 0.45, "#67e8a5");
    } else if (inActiveBounds(gem.x, gem.y, 260)) {
      nextGems.push(gem);
    }
  }
  state.entities.gems = nextGems;

  const nextPotions = [];
  for (const potion of state.entities.potions) {
    let d = distance(potion.x, potion.y, state.player.x, state.player.y);
    if (d <= state.player.pickupRadius * 0.9) {
      const dx = state.player.x - potion.x;
      const dy = state.player.y - potion.y;
      const norm = Math.hypot(dx, dy) || 1;
      const step = Math.min(d, Math.max(120, 480 - d) * dt);
      potion.x += (dx / norm) * step;
      potion.y += (dy / norm) * step;
      d = distance(potion.x, potion.y, state.player.x, state.player.y);
    }

    if (d <= state.player.radius + potion.radius + 2) {
      if (state.player.hp < state.player.maxHp) {
        const healed = Math.min(state.player.maxHp - state.player.hp, potion.heal);
        state.player.hp = Math.min(state.player.maxHp, state.player.hp + potion.heal);
        addText(state.player.x, state.player.y - 56, `+${healed} hp`, 0.5, "#ff9dcb");
      }
    } else if (inActiveBounds(potion.x, potion.y, 260)) {
      nextPotions.push(potion);
    }
  }
  state.entities.potions = nextPotions;
}

function updateEffects(dt) {
  state.entities.texts = state.entities.texts.filter((text) => {
    text.life -= dt;
    text.y -= 34 * dt;
    return text.life > 0;
  });

  state.entities.bursts = state.entities.bursts.filter((burst) => {
    burst.life -= dt;
    return burst.life > 0;
  });

  state.entities.bolts = state.entities.bolts.filter((bolt) => {
    bolt.life -= dt;
    return bolt.life > 0;
  });
}

function update(dt) {
  state.player.invuln = Math.max(0, state.player.invuln - dt);
  state.player.flash = Math.max(0, state.player.flash - dt);
  state.combat.meleeFlash = Math.max(0, state.combat.meleeFlash - dt);

  if (state.flags.levelUp || state.flags.gameOver) {
    updateEffects(dt);
    return;
  }

  state.progress.time += dt;
  updateMovement(dt);

  state.timers.spawn += dt;
  const spawnGap = Math.max(0.22, 0.92 - state.progress.time * 0.005);
  while (state.timers.spawn >= spawnGap && state.entities.enemies.length < state.limits.enemies) {
    state.timers.spawn -= spawnGap;
    spawnEnemy();
  }

  state.timers.projectile += dt;
  while (state.timers.projectile >= state.combat.projectileCooldown) {
    state.timers.projectile -= state.combat.projectileCooldown;
    fireProjectiles();
  }

  state.timers.melee += dt;
  while (state.timers.melee >= state.combat.meleeCooldown) {
    state.timers.melee -= state.combat.meleeCooldown;
    performMeleeAttack();
  }

  state.timers.chain += dt;
  while (state.timers.chain >= state.combat.chainCooldown) {
    state.timers.chain -= state.combat.chainCooldown;
    castChainLightning();
  }

  state.timers.burst += dt;
  while (state.timers.burst >= state.combat.burstCooldown) {
    state.timers.burst -= state.combat.burstCooldown;
    castSanctify();
  }

  state.timers.meteor += dt;
  while (state.timers.meteor >= state.combat.meteorCooldown) {
    state.timers.meteor -= state.combat.meteorCooldown;
    castMeteor();
  }

  updateProjectiles(dt);
  updateEnemies(dt);
  updatePickups(dt);
  updateEffects(dt);
}

function drawBackground() {
  ctx.fillStyle = "#0d1510";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const tile = 128;
  const bounds = visibleBounds(64);
  const startX = Math.floor(bounds.left / tile) - 1;
  const endX = Math.floor(bounds.right / tile) + 1;
  const startY = Math.floor(bounds.top / tile) - 1;
  const endY = Math.floor(bounds.bottom / tile) + 1;

  for (let tx = startX; tx <= endX; tx += 1) {
    for (let ty = startY; ty <= endY; ty += 1) {
      const p = worldToScreen(tx * tile, ty * tile);
      ctx.fillStyle = (tx + ty) % 2 === 0 ? "#1c2d20" : "#213223";
      ctx.fillRect(p.x, p.y, tile, tile);
      ctx.strokeStyle = "#304335";
      ctx.strokeRect(p.x, p.y, tile, tile);
      if (((tx * 31 + ty * 17) & 7) === 0) {
        ctx.strokeStyle = "#4a5f4d";
        ctx.strokeRect(p.x + 34, p.y + 34, 60, 60);
      }
    }
  }

  ctx.strokeStyle = "#4f8f76";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(HALF_W, HALF_H, 112, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(HALF_W, HALF_H, 82, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(HALF_W, HALF_H - 70);
  ctx.lineTo(HALF_W + 62, HALF_H);
  ctx.lineTo(HALF_W, HALF_H + 70);
  ctx.lineTo(HALF_W - 62, HALF_H);
  ctx.closePath();
  ctx.stroke();
}

function drawPickups() {
  for (const gem of state.entities.gems) {
    const p = worldToScreen(gem.x, gem.y);
    ctx.fillStyle = "#67e8a5";
    ctx.strokeStyle = "#d3f9d8";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - gem.radius);
    ctx.lineTo(p.x + gem.radius * 0.8, p.y);
    ctx.lineTo(p.x, p.y + gem.radius);
    ctx.lineTo(p.x - gem.radius * 0.8, p.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  for (const potion of state.entities.potions) {
    const p = worldToScreen(potion.x, potion.y);
    ctx.fillStyle = "#ff85c0";
    ctx.strokeStyle = "#ffd6e7";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, potion.radius, potion.radius * 0.82, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#8b5e34";
    ctx.fillRect(p.x - 4, p.y - potion.radius - 4, 8, 7);
  }
}

function drawEffects() {
  for (const burst of state.entities.bursts) {
    const p = worldToScreen(burst.x, burst.y);
    const ratio = 1 - burst.life / burst.maxLife;
    const radius = Math.max(10, burst.radius * ratio);
    if (burst.fill) {
      ctx.fillStyle = burst.fill;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = burst.outline;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (state.combat.meleeFlash > 0) {
    const ratio = state.combat.meleeFlash / 0.16;
    const radius = state.combat.meleeRadius + (1 - ratio) * 18;
    ctx.strokeStyle = "#ffd43b";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(HALF_W, HALF_H, radius, 3.4, 7.5);
    ctx.stroke();
  }

  for (const bolt of state.entities.bolts) {
    const a = worldToScreen(bolt.x1, bolt.y1);
    const b = worldToScreen(bolt.x2, bolt.y2);
    const mx = (a.x + b.x) / 2 + rand(-16, 16);
    const my = (a.y + b.y) / 2 + rand(-16, 16);
    const width = Math.max(1, Math.round(bolt.width * (bolt.life / bolt.maxLife)));
    ctx.strokeStyle = bolt.color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(mx, my);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = "#f8fdff";
    ctx.lineWidth = Math.max(1, width - 2);
    ctx.stroke();
  }
}

function drawEnemies() {
  for (const enemy of state.entities.enemies) {
    const p = worldToScreen(enemy.x, enemy.y);
    const r = enemy.radius;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + r * 0.8, r * 0.9, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    if (enemy.kind === "slime") {
      ctx.fillStyle = "#7ccf73";
      ctx.strokeStyle = "#2f6f31";
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, Math.PI, Math.PI * 2);
      ctx.lineTo(p.x + r, p.y + r * 0.25);
      ctx.arc(p.x, p.y + r * 0.2, r, 0, Math.PI, true);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (enemy.kind === "beast") {
      ctx.fillStyle = "#8b5e34";
      ctx.strokeStyle = "#d6b17b";
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - r);
      ctx.lineTo(p.x + r, p.y);
      ctx.lineTo(p.x + r * 0.65, p.y + r);
      ctx.lineTo(p.x - r * 0.65, p.y + r);
      ctx.lineTo(p.x - r, p.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillStyle = "#5b2c83";
      ctx.strokeStyle = "#b197fc";
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - r);
      ctx.lineTo(p.x + r * 0.82, p.y - r * 0.3);
      ctx.lineTo(p.x + r * 0.7, p.y + r);
      ctx.lineTo(p.x - r * 0.7, p.y + r);
      ctx.lineTo(p.x - r * 0.82, p.y - r * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    ctx.fillStyle = "#1f2937";
    ctx.beginPath();
    ctx.arc(p.x - r * 0.22, p.y - r * 0.06, r * 0.1, 0, Math.PI * 2);
    ctx.arc(p.x + r * 0.22, p.y - r * 0.06, r * 0.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#3d4252";
    ctx.fillRect(p.x - r, p.y - r - 12, r * 2, 5);
    ctx.fillStyle = "#69db7c";
    ctx.fillRect(p.x - r, p.y - r - 12, r * 2 * Math.max(0, enemy.hp / enemy.maxHp), 5);
  }
}

function drawProjectiles() {
  for (const projectile of state.entities.projectiles) {
    const p = worldToScreen(projectile.x, projectile.y);
    const prev = worldToScreen(projectile.x - projectile.vx * 0.03, projectile.y - projectile.vy * 0.03);
    ctx.strokeStyle = "#fff3bf";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.fillStyle = "#f3c969";
    ctx.beginPath();
    ctx.arc(p.x, p.y, projectile.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPlayer() {
  ctx.strokeStyle = "rgba(108, 196, 161, 0.25)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(HALF_W, HALF_H, state.player.pickupRadius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.ellipse(HALF_W, HALF_H + 23, 25, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#7b1e2b";
  ctx.beginPath();
  ctx.moveTo(HALF_W, HALF_H + 18);
  ctx.lineTo(HALF_W - 18, HALF_H - 8);
  ctx.lineTo(HALF_W + 18, HALF_H - 8);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#a9b8c7";
  ctx.strokeStyle = "#64748b";
  ctx.lineWidth = 2;
  ctx.fillRect(HALF_W - 10, HALF_H - 9, 20, 24);
  ctx.strokeRect(HALF_W - 10, HALF_H - 9, 20, 24);

  ctx.fillStyle = state.player.flash > 0 ? "#ffd8a8" : "#f2c59c";
  ctx.beginPath();
  ctx.arc(HALF_W, HALF_H - 16, 10, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#44536b";
  ctx.beginPath();
  ctx.arc(HALF_W, HALF_H - 19, 12, Math.PI, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#d7dee7";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(HALF_W + 12, HALF_H - 4);
  ctx.lineTo(HALF_W + 26, HALF_H - 20);
  ctx.stroke();
  ctx.fillStyle = "#f8fafc";
  ctx.beginPath();
  ctx.moveTo(HALF_W + 26, HALF_H - 20);
  ctx.lineTo(HALF_W + 34, HALF_H - 26);
  ctx.lineTo(HALF_W + 24, HALF_H - 28);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#8a6a3d";
  ctx.strokeStyle = "#d6c08d";
  ctx.beginPath();
  ctx.ellipse(HALF_W - 18, HALF_H + 4, 9, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawTexts() {
  ctx.font = "bold 18px Segoe UI";
  ctx.textAlign = "center";
  for (const text of state.entities.texts) {
    const p = worldToScreen(text.x, text.y);
    ctx.fillStyle = text.color;
    ctx.fillText(text.text, p.x, p.y);
  }
}

function drawHud() {
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(8, 18, 12, 0.82)";
  ctx.fillRect(18, 18, 360, 156);
  ctx.strokeStyle = "rgba(156, 211, 181, 0.2)";
  ctx.strokeRect(18, 18, 360, 156);

  ctx.fillStyle = "#fff8db";
  ctx.font = "bold 24px Segoe UI";
  ctx.fillText(`Time ${formatTime(state.progress.time)}`, 32, 48);
  ctx.font = "16px Segoe UI";
  ctx.fillStyle = "#d8f5d0";
  ctx.fillText(`Hero Lv ${state.progress.level}   Monsters ${state.progress.kills}`, 32, 74);
  ctx.fillStyle = "#d7e3d1";
  ctx.fillText(`Bolt ${state.combat.projectileCooldown.toFixed(2)}s  Sword ${state.combat.meleeCooldown.toFixed(2)}s`, 32, 98);
  ctx.fillText(`Storm ${state.combat.chainCooldown.toFixed(2)}s  Sanctify ${state.combat.burstCooldown.toFixed(2)}s`, 32, 120);
  ctx.fillText(`Meteor ${state.combat.meteorCooldown.toFixed(2)}s`, 32, 142);

  const hpRatio = clamp(state.player.hp / state.player.maxHp, 0, 1);
  ctx.fillStyle = "#2f3542";
  ctx.fillRect(32, 152, 220, 12);
  ctx.fillStyle = "#ff6b6b";
  ctx.fillRect(32, 152, 220 * hpRatio, 12);
  ctx.fillStyle = "#ffd8d8";
  ctx.fillText(`HP ${Math.ceil(state.player.hp)}/${state.player.maxHp}`, 260, 162);

  const xpRatio = clamp(state.progress.xp / state.progress.xpToNext, 0, 1);
  ctx.fillStyle = "#2f3542";
  ctx.fillRect(32, 172, 220, 12);
  ctx.fillStyle = "#5c7cfa";
  ctx.fillRect(32, 172, 220 * xpRatio, 12);
  ctx.fillStyle = "#dbe4ff";
  ctx.fillText(`XP ${state.progress.xp}/${state.progress.xpToNext}`, 260, 182);
}

function drawLevelUpOverlay() {
  ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffe066";
  ctx.font = "bold 34px Segoe UI";
  ctx.fillText("Sanctuary Blessing", HALF_W, 96);
  ctx.font = "18px Segoe UI";
  ctx.fillText("Press 1 / 2 / 3 or click a card", HALF_W, 126);

  cardHitboxes = [];
  const cardW = 280;
  const gap = 26;
  const total = cardW * 3 + gap * 2;
  const startX = (WIDTH - total) / 2;

  state.upgrades.forEach((upgrade, index) => {
    const x = startX + index * (cardW + gap);
    const y = 180;
    ctx.fillStyle = "rgba(17, 30, 24, 0.95)";
    ctx.fillRect(x, y, cardW, 250);
    ctx.strokeStyle = "#9ce5b0";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, cardW, 250);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 22px Segoe UI";
    ctx.fillText(`${index + 1}. ${upgrade.title}`, x + cardW / 2, y + 50);
    ctx.fillStyle = "#cfe8ff";
    ctx.font = "17px Segoe UI";
    wrapText(upgrade.desc, x + cardW / 2, y + 118, 220, 26);
    ctx.fillStyle = "#9ce5b0";
    ctx.font = "15px Segoe UI";
    ctx.fillText("Choose", x + cardW / 2, y + 216);
    cardHitboxes.push({ x, y, w: cardW, h: 250 });
  });
}

function drawGameOverOverlay() {
  ctx.fillStyle = "rgba(0, 0, 0, 0.58)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.textAlign = "center";
  ctx.fillStyle = "#ff9d9d";
  ctx.font = "bold 42px Segoe UI";
  ctx.fillText("The Hero Has Fallen", HALF_W, HALF_H - 24);
  ctx.fillStyle = "#f0f3f7";
  ctx.font = "20px Segoe UI";
  ctx.fillText(`Survived ${formatTime(state.progress.time)}   Monsters ${state.progress.kills}   Hero Lv ${state.progress.level}`, HALF_W, HALF_H + 22);
  ctx.fillStyle = "#9ce5b0";
  ctx.fillText("Press R to restart", HALF_W, HALF_H + 58);
}

function wrapText(text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  let offset = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y + offset);
      line = word;
      offset += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, y + offset);
}

function draw() {
  drawBackground();
  drawPickups();
  drawEffects();
  drawProjectiles();
  drawEnemies();
  drawPlayer();
  drawTexts();
  drawHud();
  if (state.flags.levelUp) drawLevelUpOverlay();
  if (state.flags.gameOver) drawGameOverOverlay();
}

function formatTime(seconds) {
  const total = Math.floor(seconds);
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function loop(now) {
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) event.preventDefault();
  keys.add(key);
  if (["a", "arrowleft", "d", "arrowright"].includes(key)) lastHorizontalKey = key;
  if (["w", "arrowup", "s", "arrowdown"].includes(key)) lastVerticalKey = key;

  if (state.flags.gameOver && key === "r") {
    resetGame();
    return;
  }

  if (state.flags.levelUp && ["1", "2", "3"].includes(key)) {
    applyUpgrade(Number(key) - 1);
  }
});

window.addEventListener("keyup", (event) => {
  const key = event.key.toLowerCase();
  keys.delete(key);
  if (key === lastHorizontalKey) {
    lastHorizontalKey = ["a", "arrowleft", "d", "arrowright"].find((value) => keys.has(value)) ?? null;
  }
  if (key === lastVerticalKey) {
    lastVerticalKey = ["w", "arrowup", "s", "arrowdown"].find((value) => keys.has(value)) ?? null;
  }
});

window.addEventListener("blur", () => {
  keys.clear();
  lastHorizontalKey = null;
  lastVerticalKey = null;
});

canvas.addEventListener("click", (event) => {
  if (!state.flags.levelUp) return;
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
  const y = ((event.clientY - rect.top) / rect.height) * HEIGHT;
  const index = cardHitboxes.findIndex((box) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h);
  if (index >= 0) applyUpgrade(index);
});

resetGame();
requestAnimationFrame(loop);
