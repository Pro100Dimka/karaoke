import { Component } from "react";
import { translateMessage } from "../../i18n";
import { getErrorMessage } from "../../utils/errors";
import { getSavedLanguage } from "../../utils/language";
import { Button } from "../fields";

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
    const t = (key) => translateMessage(getSavedLanguage(), key);

    return (
      <main className="application-error" role="alert">
        <div className="application-error__card">
          <span className="application-error__eyebrow">A&D Voice</span>
          <h1>{t("error.screen.title")}</h1>
          <p>{getErrorMessage(error, t("error.screen.body"))}</p>
          <Button variant="primary" onClick={() => window.location.reload()}>
            {t("error.screen.restart")}
          </Button>
        </div>
      </main>
    );
  }
}
