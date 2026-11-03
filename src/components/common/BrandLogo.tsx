const LOGO_SRC = `${import.meta.env.BASE_URL}brand/bay81-logo.webp`

export function BrandLogo({ className = '' }: { className?: string }) {
  return <img src={LOGO_SRC} alt="Bay81 Studio" className={`select-none object-contain ${className}`} draggable={false} />
}
