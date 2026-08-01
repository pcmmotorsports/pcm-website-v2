import { useMemo, useState, type FocusEvent } from 'react';
import {
  CBR600RR,
  EMPTY_VEHICLE,
  MT09,
  VEHICLE_OPTIONS,
  type Vehicle,
} from './MobileCatalogUxPrimitives';
import styles from './mobile-catalog-ux.module.css';

type Field = 'brand' | 'model' | 'year';

function matches(value: string, query: string) {
  return value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

export function VehiclePickerFields({
  draft,
  setDraft,
  onApplyGarage,
  onInputFocus,
}: {
  draft: Vehicle;
  setDraft: (vehicle: Vehicle) => void;
  onApplyGarage: (vehicle: Vehicle) => void;
  onInputFocus: (event: FocusEvent<HTMLInputElement>) => void;
}) {
  const [openField, setOpenField] = useState<Field | null>(null);
  const currentBrand = VEHICLE_OPTIONS.find((item) => item.brand === draft.brand);
  const currentModel = currentBrand?.models.find((item) => item.name === draft.model);
  const hasDraft = Boolean(draft.brand || draft.model || draft.year);

  const options = useMemo(() => ({
    brand: VEHICLE_OPTIONS.map((item) => item.brand).filter((item) => matches(item, draft.brand)),
    model: (currentBrand?.models ?? []).map((item) => item.name).filter((item) => matches(item, draft.model)),
    year: (currentModel?.years ?? []).filter((item) => matches(item, draft.year)),
  }), [currentBrand, currentModel, draft.brand, draft.model, draft.year]);

  const updateText = (field: Field, value: string) => {
    if (field === 'brand') setDraft({ brand: value.toUpperCase(), model: '', year: '' });
    if (field === 'model') setDraft({ ...draft, model: value.toUpperCase(), year: '' });
    if (field === 'year') setDraft({ ...draft, year: value.replace(/\D/g, '').slice(0, 4) });
    setOpenField(field);
  };

  const pickOption = (field: Field, value: string) => {
    if (field === 'brand') {
      setDraft({ brand: value, model: '', year: '' });
      setOpenField('model');
    }
    if (field === 'model') {
      setDraft({ ...draft, model: value, year: '' });
      setOpenField('year');
    }
    if (field === 'year') {
      setDraft({ ...draft, year: value });
      setOpenField(null);
    }
  };

  const focusField = (field: Field, event: FocusEvent<HTMLInputElement>) => {
    setOpenField(field);
    onInputFocus(event);
  };

  const clearDraft = () => {
    setDraft(EMPTY_VEHICLE);
    setOpenField(null);
  };

  const fields: Array<{ field: Field; label: string; placeholder: string; inputMode?: 'numeric' }> = [
    { field: 'brand', label: '廠牌', placeholder: '選擇或輸入廠牌' },
    { field: 'model', label: '車型', placeholder: draft.brand ? '選擇或輸入車型' : '請先選擇廠牌' },
    { field: 'year', label: '年份', placeholder: draft.model ? '選擇或輸入年份' : '請先選擇車型', inputMode: 'numeric' },
  ];

  return (
    <>
      <section className={styles.garageSection}>
        <div className={styles.garageHeading}>
          <span>我的愛車</span>
          <small>點一下直接套用</small>
        </div>
        <div className={styles.garageList}>
          {[CBR600RR, MT09].map((item) => (
            <button
              type="button"
              key={`${item.brand}-${item.model}`}
              aria-label={`套用我的愛車 ${item.brand} ${item.model} ${item.year}`}
              onClick={() => onApplyGarage(item)}
            >
              <strong>{item.model}</strong>
              <span>{item.brand}・{item.year}</span>
            </button>
          ))}
        </div>
      </section>

      <div className={styles.sheetLeadRow}>
        <p className={styles.sheetLead}>可直接選擇，也可輸入搜尋</p>
        <button
          type="button"
          aria-label="清除車輛輸入欄位"
          disabled={!hasDraft}
          onClick={clearDraft}
        >
          清除
        </button>
      </div>

      {fields.map(({ field, label, placeholder, inputMode }) => {
        const disabled = (field === 'model' && !draft.brand) || (field === 'year' && !draft.model);
        const fieldOptions = options[field];
        return (
          <div className={styles.comboboxField} key={field}>
            <span className={styles.comboboxLabel}>{label}</span>
            <div className={styles.comboboxInputRow}>
              <input
                aria-label={`輸入${label}搜尋`}
                value={draft[field]}
                placeholder={placeholder}
                inputMode={inputMode}
                autoComplete="off"
                disabled={disabled}
                onFocus={(event) => focusField(field, event)}
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
              <div className={styles.optionList} role="listbox" aria-label={`${label}選項`}>
                {fieldOptions.length > 0 ? fieldOptions.map((item) => (
                  <button type="button" key={item} onClick={() => pickOption(field, item)}>
                    {item}
                    {draft[field] === item && <span aria-hidden="true">✓</span>}
                  </button>
                )) : (
                  <p>查無符合選項，請調整文字</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
