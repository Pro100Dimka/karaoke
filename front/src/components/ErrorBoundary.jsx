import { Component } from "react";
import { translateMessage } from "../i18n";
import { Button, Modal } from "../theme/ui";
import { reportClientError } from "../utils/error-reporter";
import { getErrorMessage } from "../utils/errors";
import { getSavedLanguage } from "../utils/language";

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
    reportClientError(error?.message || String(error), {
      source: "renderer.error-boundary",
      stack: error?.stack || info?.componentStack
    });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const t = (key) => translateMessage(getSavedLanguage(), key);
    return (
      <Modal
        isOpen
        ariaLabel={t("error.screen.title")}
        titleProps={{
          eyebrow: "A&amp;D Voice",
          title: t("error.screen.title"),
          description: getErrorMessage(this.state.error, t("error.screen.body"))
        }}
      >
        <Button onClick={() => window.location.reload()}>{t("error.screen.restart")}</Button>
      </Modal>
    );
  }
}
