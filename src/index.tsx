import { render } from 'solid-js/web';
import './app.css';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('root element missing from index.html');

render(() => <App />, root);
