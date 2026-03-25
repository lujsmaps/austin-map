import './globals.css';

export const metadata = {
    title: 'Austin Startup & VC Map',
    description: 'Interactive map of Austin startups and VC firms',
};

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
