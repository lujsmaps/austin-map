'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Search } from 'lucide-react';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ufyzjboktehlkyudtyvk.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmeXpqYm9rdGVobGt5dWR0eXZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzOTQzNTcsImV4cCI6MjA4OTk3MDM1N30.AxAURMHhiOIrNU0mR3sbc8uJu6AhmnQZNWtOKR1c2Sg';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default function Home() {
    const [allOrgs, setAllOrgs] = useState([]);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('all');
    const [selectedId, setSelectedId] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchData() {
            const { data, error } = await sb
                .from('organizations')
                .select('id,name,type,website,description,logo_url,address,city,state,founded_year,stage,employee_count,exa_source_url,created_at')
                .order('name', { ascending: true });

            if (error) console.error('Supabase error:', error);
            else setAllOrgs(data || []);
            setLoading(false);
        }
        fetchData();
    }, []);

    const filteredOrgs = useMemo(() => {
        return allOrgs
            .filter(o => filter === 'all' || o.type === filter)
            .filter(o => !search ||
                o.name?.toLowerCase().includes(search.toLowerCase()) ||
                o.description?.toLowerCase().includes(search.toLowerCase()) ||
                o.website?.toLowerCase().includes(search.toLowerCase())
            );
    }, [allOrgs, search, filter]);

    const selectedOrg = useMemo(() =>
        allOrgs.find(o => o.id === selectedId),
        [allOrgs, selectedId]);

    const stats = useMemo(() => ({
        total: allOrgs.length,
        startups: allOrgs.filter(o => o.type === 'startup').length,
        vcs: allOrgs.filter(o => o.type === 'vc').length,
    }), [allOrgs]);

    const domainOf = (url) => {
        try { return new URL(url).hostname.replace(/^www\./, ''); }
        catch { return url || '—'; }
    };

    return (
        <>
            <header className="app-header">
                <h1 className="app-title">
                    ATX MAP
                    <span>Austin Startups & Venture Capital</span>
                </h1>
                <div className="meta-data-top">
                    <span className="count">{filteredOrgs.length}</span>
                    Entities Tracked<br />
                    System Active<br />
                    Austin, TX
                </div>
            </header>

            <div className="stats-row">
                <div className="stat-cell">
                    <div className="stat-number">{stats.total}</div>
                    <div className="stat-label">Total</div>
                </div>
                <div className="stat-cell">
                    <div className="stat-number">{stats.startups}</div>
                    <div className="stat-label">Startups</div>
                </div>
                <div className="stat-cell">
                    <div className="stat-number">{stats.vcs}</div>
                    <div className="stat-label">VC Firms</div>
                </div>
            </div>

            <main className="dashboard-grid">
                <section className="panel sidebar">
                    <h2 className="panel-header">
                        <span>Intel Feed</span>
                    </h2>

                    {selectedOrg && (
                        <div className="detail-card">
                            <button className="detail-close" onClick={() => setSelectedId(null)}>&times;</button>
                            <div className="d-name">{selectedOrg.name}</div>
                            <div className={`d-type-badge ${selectedOrg.type}`}>
                                {selectedOrg.type === 'vc' ? 'Venture Capital' : 'Startup'}
                            </div>
                            <div className="d-desc">{selectedOrg.description || 'No description available.'}</div>
                            {selectedOrg.website && (
                                <a className="d-link" href={selectedOrg.website} target="_blank" rel="noopener noreferrer">
                                    Visit Website →
                                </a>
                            )}
                        </div>
                    )}

                    <div className="search-box">
                        <Search size={14} strokeWidth={3} />
                        <input
                            type="text"
                            placeholder="Search entities..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>

                    <div className="data-stream">
                        {filteredOrgs.slice(0, 12).map((org, i) => (
                            <span key={org.id} className="data-entry">
                                <span className="d-label">ID</span>{' '}
                                <span className="d-value">{org.name}</span>{' '}
                                <span className={`d-status ${org.type}`}>{org.type.toUpperCase()}</span>
                            </span>
                        ))}
                    </div>
                </section>

                <section className="panel entity-grid-panel">
                    {loading ? (
                        <div className="loading-msg">Acquiring Targets...</div>
                    ) : (
                        <div className="entity-grid">
                            {filteredOrgs.map((org, i) => (
                                <div
                                    key={org.id}
                                    className={`entity-card ${org.id === selectedId ? 'selected' : ''}`}
                                    onClick={() => setSelectedId(org.id)}
                                >
                                    <div className="ec-header">
                                        <div className="ec-name">{org.name}</div>
                                        <div className={`ec-badge ${org.type}`}>
                                            {org.type === 'vc' ? 'VC' : 'Startup'}
                                        </div>
                                    </div>
                                    <div className="ec-desc">
                                        {org.description ? org.description.slice(0, 180) + '...' : 'No description available'}
                                    </div>
                                    <div className="ec-url">{domainOf(org.website)}</div>
                                    <div className="ec-id">#{String(i + 1).padStart(3, '0')}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </main>

            <nav className="controls-bar">
                <button className={`btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All Entities</button>
                <button className={`btn ${filter === 'startup' ? 'active' : ''}`} onClick={() => setFilter('startup')}>Startups</button>
                <button className={`btn ${filter === 'vc' ? 'active' : ''}`} onClick={() => setFilter('vc')}>VC Firms</button>
            </nav>
        </>
    );
}
