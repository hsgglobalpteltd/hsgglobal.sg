import React, { useState, useEffect, useRef } from "react";
import { 
  X, 
  Send, 
  User, 
  RotateCcw, 
  ShieldCheck,
  ChevronRight,
  Headphones
} from "lucide-react";

const BACKEND_URL = "https://ib-v2.hsgglobalpteltd.workers.dev";

interface ChatMessage {
  id: string;
  sender: "visitor" | "agent";
  text: string;
  timestamp: number;
}

const QUICK_SUGGESTIONS = [
  "What is the MOQ per container / pallet?",
  "Can you arrange FOB / CIF shipping?",
  "What culinary paste brands are available?",
  "How do I request physical product samples?"
];

export function ChatAssist() {
  const [isOpen, setIsOpen] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [visitorName, setVisitorName] = useState("");
  const [visitorContact, setVisitorContact] = useState("");
  const [showContactBar, setShowContactBar] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Initialize session & load history from localStorage
  useEffect(() => {
    let sId = localStorage.getItem("cs_assist_session_id");
    if (!sId) {
      sId = "cs_sess_" + Math.random().toString(36).substring(2, 11) + "_" + Date.now();
      localStorage.setItem("cs_assist_session_id", sId);
    }
    setSessionId(sId);

    let cId = localStorage.getItem("cs_assist_conv_id");
    if (!cId) {
      cId = "CS-" + Math.floor(100000 + Math.random() * 900000);
      localStorage.setItem("cs_assist_conv_id", cId);
    }
    setConversationId(cId);

    const savedName = localStorage.getItem("cs_assist_visitor_name") || "";
    const savedContact = localStorage.getItem("cs_assist_visitor_contact") || "";
    if (savedName) setVisitorName(savedName);
    if (savedContact) setVisitorContact(savedContact);

    const savedHistory = localStorage.getItem("cs_assist_history");
    if (savedHistory) {
      try {
        const parsed = JSON.parse(savedHistory);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
          return;
        }
      } catch (e) {
        // ignore json parse error
      }
    }

    // Default welcome message
    const welcomeMsg: ChatMessage = {
      id: "welcome_" + Date.now(),
      sender: "agent",
      text: "Hello! Welcome to HSG Global. I am your product and wholesale trade concierge. Feel free to ask about our product catalog, FOB/CIF shipping, pallet specifications, private label, or trade inquiry details!",
      timestamp: Date.now()
    };
    setMessages([welcomeMsg]);
  }, []);

  // Save messages to localStorage
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem("cs_assist_history", JSON.stringify(messages));
    }
  }, [messages]);

  // Auto scroll to bottom
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  }, [messages, isOpen, isLoading]);

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || isLoading) return;

    const userMessage: ChatMessage = {
      id: "msg_u_" + Date.now(),
      sender: "visitor",
      text,
      timestamp: Date.now()
    };

    const newHistory = [...messages, userMessage];
    setMessages(newHistory);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch(`${BACKEND_URL}/api/cs/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          session_id: sessionId,
          conversation_id: conversationId,
          visitor_name: visitorName || undefined,
          visitor_contact: visitorContact || undefined,
          history: newHistory
        })
      });

      const data = await response.json() as any;
      if (data && data.success && data.reply) {
        const agentMessage: ChatMessage = {
          id: "msg_a_" + Date.now(),
          sender: "agent",
          text: data.reply,
          timestamp: Date.now()
        };
        setMessages((prev) => [...prev, agentMessage]);
      } else {
        throw new Error(data?.error || "No response received");
      }
    } catch (err: any) {
      const fallbackMessage: ChatMessage = {
        id: "msg_err_" + Date.now(),
        sender: "agent",
        text: "Thank you for reaching out. Our team is reviewing catalog details. Please feel free to submit an inquiry through our form or email us directly at sales@hsg-global.com.",
        timestamp: Date.now()
      };
      setMessages((prev) => [...prev, fallbackMessage]);
    } finally {
      setIsLoading(false);
      if (!isOpen) {
        setHasUnread(true);
      }
    }
  };

  const handleResetChat = () => {
    const newCId = "CS-" + Math.floor(100000 + Math.random() * 900000);
    localStorage.setItem("cs_assist_conv_id", newCId);
    setConversationId(newCId);
    
    const welcomeMsg: ChatMessage = {
      id: "welcome_" + Date.now(),
      sender: "agent",
      text: "Hello! Welcome to HSG Global. I am your product and wholesale trade concierge. How may I assist you today?",
      timestamp: Date.now()
    };
    setMessages([welcomeMsg]);
    localStorage.setItem("cs_assist_history", JSON.stringify([welcomeMsg]));
  };

  const handleSaveContactInfo = (e: React.FormEvent) => {
    e.preventDefault();
    if (visitorName) localStorage.setItem("cs_assist_visitor_name", visitorName);
    if (visitorContact) localStorage.setItem("cs_assist_visitor_contact", visitorContact);
    setShowContactBar(false);
  };

  return (
    <div className="cs-float-container">
      {/* Floating Launcher Round Button */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => {
            setIsOpen(true);
            setHasUnread(false);
          }}
          className="cs-launcher-btn"
          aria-label="Open Chat Assist"
          title="Chat Assist Trade Concierge"
        >
          <div className="cs-launcher-icon-wrap">
            <Headphones style={{ width: "22px", height: "22px" }} />
            <span className="cs-online-badge"></span>
          </div>
          {hasUnread && (
            <span className="cs-unread-dot"></span>
          )}
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div className="cs-chat-window">
          {/* Header */}
          <div className="cs-chat-header">
            <div className="cs-header-left">
              <div className="cs-header-avatar">
                <Headphones style={{ width: "16px", height: "16px" }} />
              </div>
              <div className="cs-header-titles">
                <div className="cs-header-title-row">
                  <span className="cs-header-main-title">Chat Assist</span>
                  <span className="cs-header-tag">Concierge</span>
                </div>
                <span className="cs-header-subtitle">HSG Global Trade &amp; Service Desk</span>
              </div>
            </div>

            <div className="cs-header-actions">
              <button
                type="button"
                onClick={handleResetChat}
                title="New Chat"
                className="cs-icon-btn"
              >
                <RotateCcw style={{ width: "14px", height: "14px" }} />
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                title="Close"
                className="cs-icon-btn"
              >
                <X style={{ width: "16px", height: "16px" }} />
              </button>
            </div>
          </div>

          {/* Sub Header / Reference ID & Contact Button */}
          <div className="cs-sub-bar">
            <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <ShieldCheck style={{ width: "13px", height: "13px", color: "#d4af37" }} />
              Ref: <strong style={{ fontFamily: "monospace", color: "#1e293b" }}>{conversationId}</strong>
            </span>
            <button
              type="button"
              onClick={() => setShowContactBar(!showContactBar)}
              style={{
                background: "none",
                border: "none",
                fontSize: "11px",
                color: "#b45309",
                fontWeight: "700",
                cursor: "pointer"
              }}
            >
              {visitorName || visitorContact ? "Edit Info" : "+ Add Contact"}
            </button>
          </div>

          {/* Optional Contact Details Drawer */}
          {showContactBar && (
            <form onSubmit={handleSaveContactInfo} className="cs-contact-form">
              <span style={{ fontSize: "10px", fontWeight: "700", color: "#92400e" }}>
                Leave contact details for FOB/CIF quotation or catalog follow-up:
              </span>
              <div className="cs-contact-inputs">
                <input
                  type="text"
                  placeholder="Your Name"
                  value={visitorName}
                  onChange={(e) => setVisitorName(e.target.value)}
                  className="cs-contact-input"
                />
                <input
                  type="text"
                  placeholder="Email / WhatsApp"
                  value={visitorContact}
                  onChange={(e) => setVisitorContact(e.target.value)}
                  className="cs-contact-input"
                />
              </div>
              <button type="submit" className="cs-contact-save-btn">
                Save
              </button>
            </form>
          )}

          {/* Messages Scroll Area */}
          <div className="cs-chat-body">
            {messages.map((msg) => {
              const isVisitor = msg.sender === "visitor";
              return (
                <div
                  key={msg.id}
                  className={`cs-msg-row ${isVisitor ? "visitor" : ""}`}
                >
                  <div className={`cs-avatar-pill ${isVisitor ? "visitor" : "agent"}`}>
                    {isVisitor ? <User style={{ width: "13px", height: "13px" }} /> : "CS"}
                  </div>

                  <div className={`cs-bubble ${isVisitor ? "visitor" : "agent"}`}>
                    <div style={{ whiteSpace: "pre-wrap" }}>{msg.text}</div>
                    <div className="cs-msg-time">
                      {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ""}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Typing Indicator */}
            {isLoading && (
              <div className="cs-msg-row">
                <div className="cs-avatar-pill agent">CS</div>
                <div className="cs-typing-box" aria-label="Typing">
                  <span className="cs-dot"></span>
                  <span className="cs-dot"></span>
                  <span className="cs-dot"></span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Suggestions Chips */}
          {messages.length <= 2 && !isLoading && (
            <div className="cs-chips-container">
              {QUICK_SUGGESTIONS.map((sug, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSendMessage(sug)}
                  className="cs-chip-btn"
                >
                  <span>{sug}</span>
                  <ChevronRight style={{ width: "11px", height: "11px", color: "#94a3b8" }} />
                </button>
              ))}
            </div>
          )}

          {/* Input Footer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="cs-input-footer"
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about FOB/CIF, MOQ, product specs..."
              disabled={isLoading}
              className="cs-input-field"
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="cs-send-btn"
              aria-label="Send message"
            >
              <Send style={{ width: "14px", height: "14px" }} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
