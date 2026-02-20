(() => {
  const ReactRef = window.React;
  const ReactDOMRef = window.ReactDOM;
  if (!ReactRef || !ReactDOMRef) return;

  const e = ReactRef.createElement;

  const ProjectHeader = ({ editor = {}, exitHref = "/" }) =>
    e(
      "header",
      { className: "project-header" },
      e(
        "div",
        { className: "project-header__left" },
        e(
          "div",
          { className: "project-name-editor", id: editor.editorId || undefined },
          e(
            "span",
            {
              id: editor.displayId || undefined,
              className: "project-name-editor__display",
            },
            "Untitled Facility"
          ),
          e(
            "button",
            {
              id: editor.editButtonId || undefined,
              className: "project-name-editor__icon",
              type: "button",
              "aria-label": "Edit project name",
              title: "Edit project name",
            },
            "✎"
          ),
          e("input", {
            id: editor.inputId || undefined,
            className: "project-header__input",
            type: "text",
            placeholder: "Untitled Project",
            hidden: true,
          }),
          e(
            "button",
            {
              id: editor.saveButtonId || undefined,
              className: "project-name-editor__action",
              type: "button",
              hidden: true,
            },
            "Save"
          ),
          e(
            "button",
            {
              id: editor.cancelButtonId || undefined,
              className: "project-name-editor__action",
              type: "button",
              hidden: true,
            },
            "Cancel"
          )
        )
      ),
      e(
        "a",
        {
          className: "btn",
          href: exitHref || "/",
        },
        "Exit"
      )
    );

  const ProjectSidebar = ({ ariaLabel = "Project navigation", items = [] }) =>
    e(
      "aside",
      { className: "project-sidebar", "aria-label": ariaLabel },
      ...items.map((item, index) =>
        e(
          "a",
          {
            key: item?.key || item?.label || index,
            id: item?.id || undefined,
            className: `project-nav-btn${item?.active ? " project-nav-btn--active" : ""}`,
            href: item?.href || "#",
          },
          item?.label || ""
        )
      )
    );

  const renderIntoRoot = (root, node) => {
    if (!root) return;
    if (typeof ReactDOMRef.render === "function") {
      ReactDOMRef.render(node, root);
      return;
    }
    const mountedRoot = ReactDOMRef.createRoot ? ReactDOMRef.createRoot(root) : null;
    if (!mountedRoot) return;
    if (typeof ReactDOMRef.flushSync === "function") {
      ReactDOMRef.flushSync(() => mountedRoot.render(node));
      return;
    }
    mountedRoot.render(node);
  };

  const mount = ({ headerRootId, sidebarRootId, header = {}, sidebar = {} } = {}) => {
    const headerRoot = document.getElementById(headerRootId || "");
    const sidebarRoot = document.getElementById(sidebarRootId || "");
    renderIntoRoot(headerRoot, e(ProjectHeader, header));
    renderIntoRoot(sidebarRoot, e(ProjectSidebar, sidebar));
  };

  window.EnergyProjectShell = {
    mount,
  };
})();
