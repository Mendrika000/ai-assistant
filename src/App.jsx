import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown'; 
import './App.css'; 

const GEMINI_API_URL = import.meta.env.VITE_AI_API_URL;
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY; 

let currentController = null; 
const STORAGE_KEY = 'gemini-chat-sessions';

function App() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [temperature, setTemperature] = useState(0.7); 
  const [isListening, setIsListening] = useState(false); 
  const recognitionRef = useRef(null); 
  const [sessions, setSessions] = useState([]); 
  const [currentSessionId, setCurrentSessionId] = useState(null); 
  const [currentMessages, setCurrentMessages] = useState([]); 
  const [showHistory, setShowHistory] = useState(false); 
  const messagesEndRef = useRef(null);
  
  const generateId = () => Date.now().toString(36) + Math.random().toString(36).substring(2);

  // --- FONCTIONS VOCALES ---
  const speakResponse = (text) => {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'fr-FR'; 
        if (!isListening) {
           window.speechSynthesis.speak(utterance);
        }
    }
  };

  const startSpeechToText = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        alert("La reconnaissance vocale n'est pas supportée par ce navigateur (essayez Chrome ou Edge).");
        return;
    }

    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (isListening && recognitionRef.current) {
        recognitionRef.current.stop();
        return; 
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'fr-FR';
    recognition.interimResults = false;

    recognition.onstart = () => {
        setIsListening(true);
        setInput('Écoute en cours...'); 
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setInput(transcript); 
        setTimeout(() => sendMessage(transcript), 100);
    };

    recognition.onerror = (event) => {
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
           console.error('Erreur micro:', event.error);
        }
        setIsListening(false);
    };

    recognition.onend = () => {
        setIsListening(false);
        if (input === 'Écoute en cours...') setInput('');
    };
    
    recognitionRef.current = recognition;
    recognition.start();
  };

  // --- PERSISTANCE ---
  useEffect(() => {
    const savedSessions = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    setSessions(savedSessions);
    if (savedSessions.length > 0) {
      setCurrentSessionId(savedSessions[savedSessions.length - 1].id);
      setCurrentMessages(savedSessions[savedSessions.length - 1].messages);
    } else {
      startNewChat(false); 
    }
  }, []); 

  useEffect(() => {
    if (!currentSessionId || currentMessages.length === 0) return;
    const updatedSessions = sessions.map(session =>
      session.id === currentSessionId
        ? { 
            ...session, 
            messages: currentMessages, 
            title: session.title === 'Nouveau Chat' && currentMessages.length > 0
                    ? currentMessages[0].text.substring(0, 30) + '...'
                    : session.title
          }
        : session
    );
    setSessions(updatedSessions);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedSessions));
  }, [currentMessages]); 

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentMessages]);

  // --- GESTION DES SESSIONS ---
  const startNewChat = (savePrevious = true) => {
    if (savePrevious && currentMessages.length > 0 && currentSessionId) {
        const currentTitle = currentMessages[0].text.substring(0, 30) + '...';
        setSessions(prev => prev.map(s => s.id === currentSessionId ? {...s, title: currentTitle} : s));
    }
    if (currentController) cancelRequest(true); 
    if ('speechSynthesis' in window) window.speechSynthesis.cancel(); 
    
    const newId = generateId();
    const newSession = { id: newId, title: 'Nouveau Chat', messages: [] };
    setSessions(prev => {
        const all = [...prev, newSession];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
        return all;
    });

    setCurrentSessionId(newId);
    setCurrentMessages([]);
    setInput('');
  };

  const loadSession = (id) => {
    if (currentSessionId === id) return;
    const session = sessions.find(s => s.id === id);
    if (session) {
      if (currentController) cancelRequest(true); 
      if ('speechSynthesis' in window) window.speechSynthesis.cancel(); 
      setCurrentSessionId(id);
      setCurrentMessages(session.messages);
      setInput('');
      setShowHistory(false);
    }
  };

  const deleteSession = (e, id) => {
    e.stopPropagation();
    const updated = sessions.filter(s => s.id !== id);
    if (id === currentSessionId) startNewChat(false);
    setSessions(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  const cancelRequest = (silent = false) => {
    if (currentController) {
        currentController.abort();
        setLoading(false); 
        if (!silent) {
            const cancelMessage = { text: "Requête interrompue par l'utilisateur.", sender: 'ai' };
            setCurrentMessages(prev => [...prev, cancelMessage]);
        }
        currentController = null; 
    }
  };

  // --- ENVOI DE MESSAGE ---
  const sendMessage = async (transcript = null) => {
    if (!GEMINI_API_KEY || !GEMINI_API_KEY.startsWith("AIzaSy")) {
       alert("Erreur: La clé API Gemini n'est pas configurée correctement.");
       return;
    }
    
    const finalInput = transcript || input; 
    if (!finalInput.trim() || loading) return;

    const userMessage = { text: finalInput, sender: 'user' };
    setCurrentMessages(prev => [...prev, userMessage]);
    if (!transcript) setInput(''); else setInput(finalInput);
    setLoading(true);

    const controller = new AbortController();
    currentController = controller; 

    try {
        const contents = currentMessages
          .filter(m => m.text?.trim().length > 0)
          .map(m => ({
            role: m.sender === 'user' ? 'user' : 'model', 
            parts: [{ text: m.text }]
          }));
        contents.push({ role: "user", parts: [{ text: userMessage.text }] });

        const response = await axios.post(
          `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, 
          { contents, generationConfig: { temperature } },
          { signal: controller.signal }
        );

        const aiText = response.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "Je n'ai pas pu générer de réponse valide.";
        const aiMessage = { text: aiText, sender: 'ai' };
        setCurrentMessages(prev => [...prev, aiMessage]);
        speakResponse(aiText); 
    } catch (error) {
        if (!axios.isCancel(error)) {
            const msg = { text: "Erreur : " + (error.response ? `Code ${error.response.status}` : "Problème réseau."), sender: 'ai' };
            setCurrentMessages(prev => [...prev, msg]);
        }
    } finally {
      setLoading(false);
      currentController = null; 
      if (transcript) setInput('');
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') sendMessage();
  };

  return (
    <div className="app-container">
        
        {/* HISTORIQUE */}
        <div className={`history-sidebar ${showHistory ? 'visible' : ''}`}>
            <h2>Historique</h2>
            <button onClick={() => startNewChat(true)}>+ Nouveau Chat</button>
            <div className="session-list">
                {sessions.map(session => (
                    <div 
                        key={session.id} 
                        className={`session-item ${session.id === currentSessionId ? 'active' : ''}`}
                        onClick={() => loadSession(session.id)}
                    >
                        <span>{session.title}</span>
                        <button className="delete-btn" onClick={(e) => deleteSession(e, session.id)}>🗑️</button>
                    </div>
                ))}
            </div>
            <button className="close-sidebar" onClick={() => setShowHistory(false)}>Fermer</button>
        </div>

        {/* CONTENEUR DU CHAT */}
        <div className="chat-container">
            
            {/* HEADER avec bouton historique + titre */}
            <div className="chat-header">
                <button className="toggle-history" onClick={() => setShowHistory(!showHistory)}>
                    {showHistory ? '✖️' : '☰'}
                </button>
                <h1>Mon Assistant Vocal AI</h1>
            </div>
            
            {/* Température */}
            <div className="settings-area">
                <label>
                    Créativité ({temperature.toFixed(1)})
                    <input
                        type="range"
                        min="0.0"
                        max="1.0"
                        step="0.1"
                        value={temperature}
                        onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    />
                </label>
            </div>

            {/* Contrôles */}
            <div className="chat-controls">
                <button onClick={() => startNewChat(true)} disabled={loading}>Nouvelle conversation</button>
                {loading && (
                    <button onClick={() => cancelRequest(false)} className="cancel-button">🛑 Interrompre</button>
                )}
            </div>

            {/* Zone messages */}
            <div className="messages-display">
                {currentMessages.map((msg, i) => (
                    <div key={i} className={`message ${msg.sender}`}>
                        <span className="sender-label">{msg.sender === 'user' ? 'Vous : ' : 'IA : '}</span>
                        <ReactMarkdown>{msg.text}</ReactMarkdown>
                    </div>
                ))}
                {loading && <div className="loading">L'IA réfléchit...</div>}
                <div ref={messagesEndRef} />
            </div>

            {/* Entrée utilisateur */}
            <div className="input-area">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder={isListening ? 'Écoute...' : 'Posez votre question...'}
                    disabled={loading || isListening}
                />
                
                <button 
                    onClick={startSpeechToText} 
                    disabled={loading} 
                    className={`microphone-button ${isListening ? 'listening' : ''}`}
                >
                    {isListening ? '🔴' : '🎙️'}
                </button>
                
                <button onClick={() => sendMessage()} disabled={loading || isListening}>Envoyer</button>
            </div>
        </div>
    </div>
  );
}

export default App;
