export default function Icon({ name, size = 18 }) {
  const paths = {
    warning:<><path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></>, radio:<><circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/></>,
    check:<path d="m5 12 4 4L19 6"/>, users:<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></>, megaphone:<><path d="m3 11 18-5v12L3 14v-3Z"/><path d="m11.6 16 1.2 5H7l-1.5-6"/></>,
    pin:<><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>, clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>, shield:<><path d="M12 3 4.5 6v5c0 4.8 3.1 8.3 7.5 10 4.4-1.7 7.5-5.2 7.5-10V6L12 3Z"/><path d="m9 12 2 2 4-4"/></>, folder:<path d="M3 6h7l2 2h9v11H3V6Z"/>,
    phone:<path d="M6.5 3.5 9 8l-2 2c1.5 3 4 5.5 7 7l2-2 4.5 2.5-1 3c-.3 1-1.3 1.5-2.3 1.3C9.5 20.5 3.5 14.5 2.2 6.8 2 5.8 2.5 4.8 3.5 4.5l3-1Z"/>, search:<><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></>, menu:<path d="M4 7h16M4 12h16M4 17h16"/>, bell:<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
  };
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.folder}</svg>;
}
