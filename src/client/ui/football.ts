import { overallRating, type PlayerProfile } from '../../shared/model/player';
import { h } from './dom';

export const ART = { match: '/art/matchday.jpg', night: '/art/friends-night.jpg', stadium: '/art/stadium.jpg' } as const;

export function wordmark(): HTMLElement {
  return h('div', { class: 'game-wordmark', 'aria-label': '4-4-2 Club Football' }, h('strong', null, '4', h('i', null, '·'), '4', h('i', null, '·'), '2'), h('small', null, 'CLUB FOOTBALL'));
}

export function artImage(src: string, cls = ''): HTMLImageElement {
  return h('img', { src, class: `game-art ${cls}`, alt: '', draggable: false, decoding: 'async' });
}

export function gameTile(options: { image: string; tone: string; label: string; title: string; text: string; action: string; onClick: () => void; hero?: boolean }): HTMLButtonElement {
  return h('button', { class: `game-tile game-tile--${options.tone}${options.hero ? ' game-tile--hero' : ''}`, onClick: options.onClick },
    artImage(options.image), h('span', { class: 'game-tile__shade' }),
    h('span', { class: 'game-tile__copy' }, h('small', { class: 'game-tile__label' }, options.label),
      h('strong', { class: 'game-tile__title' }, options.title), h('span', { class: 'game-tile__text' }, options.text)),
    h('span', { class: 'game-tile__action' }, options.action, h('b', { 'aria-hidden': 'true' }, '↗')));
}

/** A player's own kit and number, rather than a stock photograph pretending to be their face. */
export function kitPortrait(number: number, color: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 160 160'); svg.setAttribute('aria-hidden', 'true'); svg.classList.add('kit-portrait');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M49 24 25 35 5 70 33 86 43 69 40 148 120 148 117 69 127 86 155 70 135 35 111 24 96 15C91 31 69 31 64 15Z');
  path.setAttribute('fill', color); path.setAttribute('stroke', 'rgba(255,255,255,.65)'); path.setAttribute('stroke-width', '2');
  const neck = document.createElementNS(ns, 'path'); neck.setAttribute('d', 'M64 17 Q80 41 96 17'); neck.setAttribute('fill', 'none'); neck.setAttribute('stroke', '#ffffff'); neck.setAttribute('stroke-width', '5');
  const text = document.createElementNS(ns, 'text'); text.setAttribute('x', '80'); text.setAttribute('y', '112'); text.setAttribute('text-anchor', 'middle'); text.setAttribute('fill', 'white'); text.setAttribute('font-size', '63'); text.setAttribute('font-family', 'Impact,Arial,sans-serif'); text.textContent = String(number);
  svg.append(path, neck, text); return svg;
}

export function footballerCard(player: PlayerProfile, color: string, selected = false, onClick?: () => void): HTMLElement {
  return h('button', { class: `footballer-card${selected ? ' is-selected' : ''}`, 'aria-pressed': String(selected), onClick, 'aria-label': `${player.name}, ${player.position}, overall ${Math.round(overallRating(player))}` },
    h('span', { class: 'footballer-card__rating' }, h('b', null, Math.round(overallRating(player))), h('small', null, player.position)),
    kitPortrait(player.number, color), h('strong', { class: 'footballer-card__name' }, player.name),
    h('span', { class: 'footballer-card__stats' }, ...(['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical'] as const).map((key, i) => h('span', null, h('b', null, player.attributes[key]), ' ', ['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY'][i]))),
    h('small', { class: 'footballer-card__foot' }, `GK ${player.attributes.goalkeeping} · STA ${player.attributes.stamina} · AGE ${player.age}`));
}
