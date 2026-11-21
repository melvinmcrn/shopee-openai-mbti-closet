export function ProfilePhotoChoice({ checked, onChange, disabled }: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex min-h-11 items-center gap-3 text-sm">
      <input type="checkbox" checked={checked} disabled={disabled}
        onChange={event => onChange(event.target.checked)} className="size-4 shrink-0 accent-primary" />
      Use my profile photo for all looks and send it to OpenAI for styling
    </label>
  );
}
