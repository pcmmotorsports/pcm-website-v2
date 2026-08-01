import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import {
  CBR600RR,
  MT09,
  VEHICLE_OPTIONS,
  type Vehicle,
} from './MobileCatalogUxPrimitives';
import styles from './desktop-catalog-ux.module.css';

type Field = 'brand' | 'model' | 'year';

function matches(value: string, query: string) {
  return value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

export function DesktopVehiclePicker({
  draft,
  vehicle,
  setDraft,
  onApply,
  onClearDraft,
  onClearVehicle,
}: {
  draft: Vehicle;
  vehicle: Vehicle | null;
  setDraft: Dispatch<SetStateAction<Vehicle>>;
  onApply: (vehicle: Vehicle) => void;
  onClearDraft: () => void;
  onClearVehicle: () => void;
}) {
  const [openField, setOpenField] = useState<Field | null>(null);
  const currentBrand = VEHICLE_OPTIONS.find((item) => item.brand === draft.brand);
  const currentModel = currentBrand?.models.find((item) => item.name === draft.model);
  const hasDraft = Boolean(draft.brand || draft.model || draft.year);
  const complete = Boolean(draft.brand && draft.model && draft.year);

  const options = useMemo(() => ({
    brand: VEHICLE_OPTIONS.map((item) => item.brand).filter((item) => matches(item, draft.brand)),
    model: (currentBrand?.models ?? []).map((item) => item.name).filter((item) => matches(item, draft.model)),
    year: (currentModel?.years ?? []).filter((item) => matches(item, draft.year)),
  }), [currentBrand, currentModel, draft.brand, draft.model, draft.year]);

  const updateText = (field: Field, value: string) => {
    if (field === 'brand') setDraft({ brand: value.toUpperCase(), model: '', year: '' });
    if (field === 'model') setDraft((current) => ({ ...current, model: value.toUpperCase(), year: '' }));
    if (field === 'year') {
      setDraft((current) => ({ ...current, year: value.replace(/\D/g, '').slice(0, 4) }));
    }
    setOpenField(field);
  };

  const pickOption = (field: Field, value: string) => {
    if (field === 'brand') {
      setDraft({ brand: value, model: '', year: '' });
      setOpenField('model');
      return;
    }
    if (field === 'model') {
      setDraft((current) => ({ ...current, model: value, year: '' }));
      setOpenField('year');
      return;
    }
    const next = { ...draft, year: value };
    setDraft(next);
    onApply(next);
    setOpenField(null);
  };

  const clearDraft = () => {
    onClearDraft();
    setOpenField(null);
  };

  const fields: Array<{ field: Field; label: string; placeholder: string; numeric?: boolean }> = [
    { field: 'brand', label: '廠牌', placeholder: '選擇或輸入廠牌' },
    { field: 'model', label: '車型', placeholder: draft.brand ? '選擇或輸入車型' : '請先選擇廠牌' },
    { field: 'year', label: '年份', placeholder: draft.model ? '選擇或輸入年份' : '請先選擇車型', numeric: true },
  ];

  return (
    <div className={styles.vehiclePicker}>
      <div className={styles.garageBlock}>
        <span className={styles.pickerLabel}>我的愛車</span>
        <div className={styles.garageButtons}>
          {[CBR600RR, MT09].map((item) => (
            <button
              type="button"
              key={`${item.brand}-${item.model}`}
              aria-label={`桌機套用我的愛車 ${item.brand} ${item.model} ${item.year}`}
              onClick={() => {
                setDraft(item);
                onApply(item);
                setOpenField(null);
              }}
            >
              <strong>{item.model}</strong>
              <small>{item.brand}・{item.year}</small>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.fields}>
        {fields.map(({ field, label, placeholder, numeric }) => {
          const disabled = (field === 'model' && !draft.brand) || (field === 'year' && !draft.model);
          return (
            <label className={styles.field} key={field}>
              <span>{label}</span>
              <div className={styles.inputShell}>
                <input
                  aria-label={`輸入${label}搜尋`}
                  value={draft[field]}
                  placeholder={placeholder}
                  inputMode={numeric ? 'numeric' : undefined}
                  autoComplete="off"
                  disabled={disabled}
                  onFocus={() => setOpenField(field)}
                  onChange={(event) => updateText(field, event.target.value)}
                />
                <button
                  type="button"
                  aria-label={`展開${label}選項`}
                  disabled={disabled}
                  onClick={() => setOpenField(openField === field ? null : field)}
                >
                  {openField === field ? '⌃' : '⌄'}
                </button>
              </div>
              {openField === field && !disabled && (
                <div
                  className={styles.optionList}
                  role="listbox"
                  aria-label={`桌機${label}選項`}
                >
                  {options[field].length > 0 ? options[field].map((item) => (
                    <button type="button" key={item} onClick={() => pickOption(field, item)}>
                      {item}
                      {draft[field] === item && <span aria-hidden="true">✓</span>}
                    </button>
                  )) : <p>查無符合選項</p>}
                </div>
              )}
            </label>
          );
        })}
      </div>

      <div className={styles.vehicleActions}>
        <button
          type="button"
          className={styles.applyVehicle}
          disabled={!complete}
          onClick={() => onApply(draft)}
        >
          套用車輛
        </button>
        <button
          type="button"
          aria-label="清除車輛輸入欄位"
          disabled={!hasDraft}
          onClick={clearDraft}
        >
          清除輸入
        </button>
        {vehicle && (
          <button type="button" aria-label="清除已套用車輛" onClick={onClearVehicle}>
            清除車輛
          </button>
        )}
      </div>
    </div>
  );
}
