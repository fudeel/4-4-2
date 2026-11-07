import type { ClientState } from '../../state/GameStore';
import { h, setText } from '../dom';
import type { Screen, ScreenContext } from './Screen';

export class AccountScreen implements Screen {
  readonly element: HTMLElement;
  private registering = true;
  private readonly title = h('h1', null, 'Your touchline. Your club.');
  private readonly username = h('input', { class: 'input', name: 'username', 'aria-label': 'Username', required: true, maxlength: 16, autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' });
  private readonly password = h('input', { class: 'input', type: 'password', name: 'password', 'aria-label': 'Password', required: true, minlength: 8, maxlength: 128, autocomplete: 'new-password' });
  private readonly submit = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, 'Create account');
  private readonly toggle: HTMLButtonElement;
  private readonly status = h('p', { role: 'status', class: 'account-status' });
  constructor(ctx: ScreenContext) {
    this.toggle = h('button', { class: 'btn btn--ghost btn--block', type: 'button', onClick: () => {
      this.registering = !this.registering;
      setText(this.submit, this.registering ? 'Create account' : 'Sign in');
      setText(this.toggle, this.registering ? 'Already a manager? Sign in' : 'New here? Create an account');
      this.password.autocomplete = this.registering ? 'new-password' : 'current-password';
    } }, 'Already a manager? Sign in');
    this.element = h('main', { class: 'home account-screen' },
      h('header', { class: 'home__hero' }, h('div', { class: 'logo' }, '4 - 4 - 2'), this.title, h('p', { class: 'home__tagline' }, 'Build a club. Outthink your friends. Own the night.')),
      h('form', { class: 'panel home__panel', onSubmit: (e: SubmitEvent) => { e.preventDefault(); ctx.actions.signIn(this.username.value, this.password.value, this.registering); } },
        h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Username'), this.username),
        h('small', null, 'Letters only · up to 16 characters · no numbers or symbols'),
        h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Password'), this.password),
        h('small', null, '8–128 characters. Use a password you can remember.'), this.status, this.submit, this.toggle),
    );
  }
  update(state: ClientState): void {
    this.submit.disabled = !state.authReady || state.authBusy;
    this.toggle.disabled = state.authBusy;
    setText(this.status, !state.authReady ? 'Restoring your session…' : state.authBusy ? 'One moment…' : state.authError);
  }
  destroy(): void { this.password.value = ''; }
}
