import React from 'react';
import { SUPPORTED_LANGUAGES } from '../types';

interface LanguageSelectorProps {
  selectedLanguage: string;
  onSelect: (lang: string) => void;
  disabled?: boolean;
}

const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  selectedLanguage,
  onSelect,
  disabled
}) => {
  return (
    <div className="flex items-center space-x-2">
      <label htmlFor="language" className="text-sm font-medium text-slate-700 whitespace-nowrap">
        Translate to:
      </label>
      <select
        id="language"
        value={selectedLanguage}
        onChange={(e) => onSelect(e.target.value)}
        disabled={disabled}
        className="block w-full rounded-md border-slate-300 bg-white py-2 pl-3 pr-10 text-base focus:border-indigo-500 focus:outline-none focus:ring-indigo-500 sm:text-sm shadow-sm border"
      >
        <option value="" disabled>Select a language</option>
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.name}>
            {lang.name}
          </option>
        ))}
      </select>
    </div>
  );
};

export default LanguageSelector;