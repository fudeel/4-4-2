import { App } from './App';
import { Sfx } from './audio/Sfx';
import { GameConnection } from './net/GameConnection';
import { Identity } from './net/Identity';
import { GameStore } from './state/GameStore';
import './styles/main.css';

const identity = new Identity();
const store = new GameStore({ club: null, clubReady: false, clubBusy: false, clubError: '', account: null, authReady: false, authBusy: false, authError: '', connection: 'offline', view: null, clockOffset: 0, playerName: identity.name });
const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root element');

new App(root, new GameConnection(), store, identity, new Sfx()).start();
