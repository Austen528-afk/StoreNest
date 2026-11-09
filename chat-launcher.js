(() => {
  const mountChatLauncher = () => {
    if (document.getElementById("storenestChatLauncher")) return;

    const launcher = document.createElement("button");
    launcher.id = "storenestChatLauncher";
    launcher.type = "button";
    launcher.className = "storenest-chat-launcher";
    launcher.setAttribute("aria-label", "Open Chat Centre");
    launcher.title = "Chat Centre";
    launcher.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5 7.7 7.7 0 0 1-3.1-.65L4 20l1.55-4.55A7.47 7.47 0 1 1 20 11.5Z"></path></svg>';

    const style = document.createElement("style");
    style.textContent = `
      .storenest-chat-launcher {
        position: fixed;
        right: calc(22px + env(safe-area-inset-right, 0px));
        bottom: calc(22px + env(safe-area-inset-bottom, 0px));
        z-index: 89;
        display: grid;
        place-items: center;
        width: 50px;
        height: 50px;
        padding: 0;
        border: 1px solid #cbd8df;
        border-radius: 15px;
        background: #fff;
        color: #172027;
        box-shadow: 0 4px 13px rgba(23, 32, 39, .16);
        cursor: pointer;
        transition: transform .16s ease, box-shadow .16s ease;
      }
      .storenest-chat-launcher svg {
        width: 29px;
        height: 29px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .storenest-chat-launcher:hover {
        transform: translateY(-2px);
        box-shadow: 0 7px 18px rgba(23, 32, 39, .2);
      }
      .storenest-chat-launcher:focus-visible {
        outline: 3px solid #52cdb0;
        outline-offset: 3px;
      }
      @media (max-width: 600px) {
        .storenest-chat-launcher {
          right: calc(16px + env(safe-area-inset-right, 0px));
          bottom: calc(16px + env(safe-area-inset-bottom, 0px));
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .storenest-chat-launcher { transition: none; }
      }
    `;
    document.head.append(style);
    launcher.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("storenest:open-chat-centre"));
    });
    document.body.append(launcher);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountChatLauncher, { once: true });
  } else {
    mountChatLauncher();
  }
})();
