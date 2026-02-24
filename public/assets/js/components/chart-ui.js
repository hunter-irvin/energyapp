(() => {
  const ReactRef = window.React;
  const ReactDOMRef = window.ReactDOM;
  if (!ReactRef || !ReactDOMRef) return;

  const e = ReactRef.createElement;

  const renderToggleButton = (button) =>
    e(
      "button",
      {
        className: `btn btn--toggle${button?.active ? " is-active" : ""}`,
        type: "button",
        onClick: button?.onClick,
        disabled: Boolean(button?.disabled),
        "aria-pressed": String(Boolean(button?.active)),
        ...(button?.dataAttr || {}),
      },
      button?.label || ""
    );

  const TimeWindowControls = (props) => {
    const dateInputRef = ReactRef.useRef(null);
    const groups = Array.isArray(props?.groups) ? props.groups : [];
    const rightGroupKeys = new Set(Array.isArray(props?.rightGroupKeys) ? props.rightGroupKeys : []);
    const leftGroups = groups.filter((group) => !rightGroupKeys.has(group?.key));
    const rightGroups = groups.filter((group) => rightGroupKeys.has(group?.key));

    const openDatePicker = () => {
      const input = dateInputRef.current;
      if (!input) return;
      if (typeof input.showPicker === "function") input.showPicker();
      else input.click();
    };

    const renderGroup = (group, groupIndex) => {
      const parts = [];
      if (group?.label) {
        parts.push(
          e(
            "span",
            {
              key: `label-${groupIndex}-${group.label}`,
              className: group.labelClassName || "assets-label rates-control-label rates-control-label--inline",
            },
            group.label
          )
        );
      }
      const buttons = Array.isArray(group?.buttons) ? group.buttons : [];
      buttons.forEach((button, buttonIndex) => {
        parts.push(
          e(ReactRef.Fragment, { key: `button-${groupIndex}-${button?.key || buttonIndex}` }, renderToggleButton(button))
        );
      });
      return parts;
    };

    return e(
      "div",
      { className: `${props?.className || "toggle-group assets-toggle-group"} time-window-controls` },
      e(
        "div",
        { className: "time-window-controls__left" },
        ...leftGroups.flatMap((group, groupIndex) => renderGroup(group, groupIndex)),
        e(
          "button",
          {
            className: "btn btn--icon",
            type: "button",
            "aria-label": props?.pickDateAriaLabel || "Pick a date",
            onClick: openDatePicker,
          },
          props?.dateIcon || "📅"
        ),
        e("input", {
          ref: dateInputRef,
          className: "date-picker",
          type: "date",
          "aria-label": props?.selectDateAriaLabel || "Select date",
          value: props?.selectedDateKey || "",
          onChange: (event) => props?.onDateChange?.(event.target.value),
        }),
        e(
          "button",
          {
            className: "btn btn--icon",
            type: "button",
            "aria-label": props?.previousAriaLabel || "Previous range",
            onClick: () => props?.onShift?.(-1),
          },
          props?.previousIcon || "◀"
        ),
        e("span", { className: props?.readoutClassName || "assets-date-range-readout" }, props?.dateRangeText || "--"),
        e(
          "button",
          {
            className: "btn btn--icon",
            type: "button",
            "aria-label": props?.nextAriaLabel || "Next range",
            onClick: () => props?.onShift?.(1),
          },
          props?.nextIcon || "▶"
        )
      ),
      rightGroups.length
        ? e("div", { className: "time-window-controls__right" }, ...rightGroups.flatMap((group, groupIndex) => renderGroup(group, groupIndex)))
        : null
    );
  };

  const LegendToggles = (props) => {
    const items = Array.isArray(props?.items) ? props.items : [];
    return e(
      props?.tagName || "p",
      { className: props?.className || "chart-panel__legend" },
      ...items.map((item, index) =>
        e(
          "button",
          {
            key: item?.key || index,
            className: `legend ${item?.className || ""}${item?.active ? " is-active" : ""}`.trim(),
            type: "button",
            onClick: item?.onToggle,
            "aria-pressed": String(Boolean(item?.active)),
          },
          item?.label || ""
        )
      )
    );
  };

  const AssetFieldInput = ({ assetId, dataPrefix, field, model, onFieldChange, onFieldHelpShow, onFieldHelpHide, onFieldHelpMove }) => {
    const dataKey = `data-${dataPrefix}-field`;
    const domProps = {
      [dataKey]: field?.key || "",
      className: "assets-input",
      onMouseEnter: (event) =>
        onFieldHelpShow?.({
          anchor: event.currentTarget,
          assetId,
          fieldKey: field?.key,
          labelText: field?.label,
          clientX: event.clientX,
          clientY: event.clientY,
        }),
      onMouseLeave: () => onFieldHelpHide?.(),
      onMouseMove: (event) => onFieldHelpMove?.({ clientX: event.clientX, clientY: event.clientY }),
      onFocus: (event) =>
        onFieldHelpShow?.({
          anchor: event.currentTarget,
          assetId,
          fieldKey: field?.key,
          labelText: field?.label,
        }),
      onBlur: () => onFieldHelpHide?.(),
      onInput: (event) =>
        onFieldChange?.({
          assetId,
          fieldKey: field?.key,
          value: event.target.value,
          inputType: field?.type || "text",
        }),
      onChange: (event) =>
        onFieldChange?.({
          assetId,
          fieldKey: field?.key,
          value: event.target.value,
          inputType: field?.type || "text",
        }),
    };
    const rawValue = model?.[field?.key];
    const value =
      typeof field?.formatValue === "function" ? field.formatValue(rawValue, model) : rawValue == null ? "" : String(rawValue);

    if (field?.type === "select") {
      return e(
        "select",
        {
          ...domProps,
          value,
        },
        ...(Array.isArray(field?.options) ? field.options : []).map((option, index) =>
          e(
            "option",
            {
              key: `${field?.key || "field"}-${option?.value ?? index}`,
              value: option?.value ?? "",
            },
            option?.label ?? String(option?.value ?? "")
          )
        )
      );
    }

    return e("input", {
      ...domProps,
      type: field?.type || "text",
      min: field?.min,
      max: field?.max,
      step: field?.step,
      value,
    });
  };

  const AssetFieldRow = ({ assetId, dataPrefix, field, model, onFieldChange, onFieldHelpShow, onFieldHelpHide, onFieldHelpMove }) =>
    e(
      ReactRef.Fragment,
      { key: `${assetId}-${field?.key}` },
      e(
        "label",
        {
          className: "assets-label",
          onMouseEnter: (event) =>
            onFieldHelpShow?.({
              anchor: event.currentTarget,
              assetId,
              fieldKey: field?.key,
              labelText: field?.label,
              clientX: event.clientX,
              clientY: event.clientY,
            }),
          onMouseLeave: () => onFieldHelpHide?.(),
          onMouseMove: (event) => onFieldHelpMove?.({ clientX: event.clientX, clientY: event.clientY }),
          onFocus: (event) =>
            onFieldHelpShow?.({
              anchor: event.currentTarget,
              assetId,
              fieldKey: field?.key,
              labelText: field?.label,
            }),
          onBlur: () => onFieldHelpHide?.(),
          tabIndex: 0,
        },
        field?.label || "",
        field?.optional ? e("span", { className: "assets-optional" }, " (Optional)") : null
      ),
      e(AssetFieldInput, {
        assetId,
        dataPrefix,
        field,
        model,
        onFieldChange,
        onFieldHelpShow,
        onFieldHelpHide,
        onFieldHelpMove,
      })
    );

  const AssetSection = ({
    assetId,
    dataPrefix,
    section,
    model,
    onFieldChange,
    onFieldHelpShow,
    onFieldHelpHide,
    onFieldHelpMove,
  }) => {
    const [collapsed, setCollapsed] = ReactRef.useState(Boolean(section?.collapsed));
    return e(
      "div",
      {
        className: `asset-section asset-section--${section?.key || "basic"}${collapsed ? " is-collapsed" : ""}`,
      },
      e(
        "div",
        { className: "asset-section__header" },
        e(
          "p",
          {
            className: `assets-subtitle${section?.muted ? " assets-subtitle--muted" : ""}`,
          },
          section?.title || ""
        ),
        e(
          "button",
          {
            className: "asset-section-toggle",
            type: "button",
            "aria-expanded": String(!collapsed),
            "aria-label": `${collapsed ? "Expand" : "Collapse"} ${section?.title || "section"} fields`,
            onClick: () => setCollapsed((value) => !value),
          },
          collapsed ? "▸" : "▾"
        )
      ),
      e(
        "div",
        { className: "asset-section__body assets-fields" },
        ...(Array.isArray(section?.fields) ? section.fields : []).map((field) =>
          e(AssetFieldRow, {
            key: `${assetId}-${section?.key || "section"}-${field?.key || "field"}`,
            assetId,
            dataPrefix,
            field,
            model,
            onFieldChange,
            onFieldHelpShow,
            onFieldHelpHide,
            onFieldHelpMove,
          })
        )
      )
    );
  };

  const AssetEditors = (props) => {
    const entries = Array.isArray(props?.entries) ? props.entries : [];
    const sections = Array.isArray(props?.sections) ? props.sections : [];
    const dataPrefix = props?.dataPrefix || "asset";
    return e(
      ReactRef.Fragment,
      null,
      ...entries.map((entry) =>
        e(
          "div",
          {
            key: entry?.id,
            className: "asset-card",
            "data-asset-type": props?.assetType || "asset",
            "data-asset-id": entry?.id || "",
          },
          e(
            "button",
            {
              className: "asset-delete",
              type: "button",
              "aria-label": props?.deleteLabel || "Delete asset",
              onClick: () => props?.onDelete?.(entry?.id),
            },
            "×"
          ),
          e("input", {
            className: "asset-title-input",
            type: "text",
            [`data-${dataPrefix}-field`]: "name",
            "aria-label": props?.nameAriaLabel || "Asset name",
            value: entry?.model?.name == null ? "" : String(entry.model.name),
            onInput: (event) =>
              props?.onFieldChange?.({
                assetId: entry?.id,
                fieldKey: "name",
                value: event.target.value,
                inputType: "text",
              }),
            onChange: (event) =>
              props?.onFieldChange?.({
                assetId: entry?.id,
                fieldKey: "name",
                value: event.target.value,
                inputType: "text",
              }),
          }),
          ...sections.map((section) =>
            e(AssetSection, {
              key: `${entry?.id}-${section?.key || "section"}`,
              assetId: entry?.id,
              dataPrefix,
              section,
              model: entry?.model || {},
              onFieldChange: props?.onFieldChange,
              onFieldHelpShow: props?.onFieldHelpShow,
              onFieldHelpHide: props?.onFieldHelpHide,
              onFieldHelpMove: props?.onFieldHelpMove,
            })
          )
        )
      )
    );
  };

  const createBridgeForComponent = (Component) => {
    let root = null;
    let container = null;
    let lastProps = {};

    const render = () => {
      if (!container || !root) return;
      root.render(e(Component, lastProps));
    };

    return {
      mount(el, props) {
        if (!el) return;
        container = el;
        lastProps = { ...props };
        if (typeof ReactDOMRef.render === "function") {
          ReactDOMRef.render(e(Component, lastProps), container);
          return;
        }
        root = typeof ReactDOMRef.createRoot === "function" ? ReactDOMRef.createRoot(container) : null;
        if (root) {
          if (typeof ReactDOMRef.flushSync === "function") {
            ReactDOMRef.flushSync(() => render());
          } else {
            render();
          }
        }
      },
      update(nextProps) {
        lastProps = { ...lastProps, ...nextProps };
        if (root) {
          render();
          return;
        }
        if (container) {
          ReactDOMRef.render(e(Component, lastProps), container);
        }
      },
      unmount() {
        if (root) {
          root.unmount();
          root = null;
        } else if (container) {
          ReactDOMRef.unmountComponentAtNode(container);
        }
        container = null;
      },
    };
  };

  window.EnergyChartUI = {
    createTimeWindowControlsBridge: () => createBridgeForComponent(TimeWindowControls),
    createLegendTogglesBridge: () => createBridgeForComponent(LegendToggles),
    createAssetEditorsBridge: () => createBridgeForComponent(AssetEditors),
  };
})();
