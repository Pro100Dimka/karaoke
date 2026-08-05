import { Component } from "react";
import { getErrorMessage } from "../../utils/errors";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Unhandled application error", error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="application-error" role="alert">
        <div className="application-error__card">
          <span className="application-error__eyebrow">Karaoke Studio</span>
          <h1>Не удалось открыть экран</h1>
          <p>{getErrorMessage(error, "Произошла непредвиденная ошибка.")}</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.location.reload()}
          >
            Перезапустить интерфейс
          </button>
        </div>
      </main>
    );
  }
}
