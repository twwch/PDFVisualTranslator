import React from 'react';

interface LanguageOption {
  code: string;
  name: string;
}

interface LanguageSelectorProps {
  label: string;
  selectedLanguage: string;
  languages: LanguageOption[];
  onSelect: (lang: string) => void;
  disabled?: boolean;
}

const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  label,
  selectedLanguage,
  languages,
  onSelect,
  disabled
}) => {
  return (
    <div className="flex items-center space-x-2">
      <label className="text-sm font-medium text-slate-700 whitespace-nowrap hidden lg:block">
        {label}
      </label>
      <select
        value={selectedLanguage}
        onChange={(e) => onSelect(e.target.value)}
        disabled={disabled}
        className="block w-full rounded-md border-slate-300 bg-white py-2 pl-3 pr-8 text-base focus:border-indigo-500 focus:outline-none focus:ring-indigo-500 sm:text-sm shadow-sm border truncate max-w-[180px]"
      >
        <option value="" disabled>Select...</option>
        {languages.map((lang) => (
          <option key={lang.code} value={lang.name}>
            {lang.name}
          </option>
        ))}
      </select>
    </div>
  );
};

export default LanguageSelector;