import { Component, type ErrorInfo, type ReactNode } from 'react';
import { SAVE_KEY } from '../sim/save';

/** Last line of defence: a bug in one panel must never leave the player with a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('SIGNAL 911 crashed:', error, info.componentStack); }
  reset = () => {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* storage unavailable */ }
    location.reload();
  };
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="modal"><div className="card">
        <h1>Something went wrong</h1>
        <p className="muted">The game hit an unexpected error. Your saved progress is untouched. Reloading usually fixes it.</p>
        <pre className="crash">{this.state.error.message}</pre>
        <button className="primary big" onClick={() => location.reload()}>Reload game</button>
        <button className="danger big" onClick={() => { if (window.confirm('Erase all saved progress and reload?')) this.reset(); }}>Erase save and reload</button>
      </div></div>
    );
  }
}
