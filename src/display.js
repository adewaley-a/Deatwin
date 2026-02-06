/* eslint-disable jsx-a11y/anchor-is-valid */
import './display.css';
import React, { useState, useRef } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import 'swiper/css';
import 'swiper/css/autoplay';
import { Autoplay } from 'swiper/modules';
import bot from './profilerbot.png';
import copy from './copyiconw.png';
import Plink from './plink';

function Display(props) {
  const [currentURL, setCurrentURL] = useState('');
  const [loading, setLoading] = useState(false);
  
  // ETH Wallet Address
  const ethAddress = "0x2D7A152b7a67b992820B58ba2Af0B9eA469ee464";

  // NEW: Function to copy ETH address
  const handleEthCopy = () => {
    navigator.clipboard.writeText(ethAddress)
      .then(() => alert("Address copied!"))
      .catch(err => console.error("Copy failed", err));
  };

  const showCurrentURL = async () => {
    if (loading) return;
    setLoading(true);
    try {
      let longUrl = window.location.href;
      if (!longUrl.startsWith('http')) {
        longUrl = `https://${longUrl}`;
      }
      const res = await fetch("/.netlify/functions/shorten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ longUrl })
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const errorMessage = errorData.error || "Server error";
        alert(`Error: ${errorMessage}.`);
        setLoading(false);
        return;
      }
      const data = await res.json();
      if (data.shortURL) {
        const cleanLink = data.shortURL.replace(/^https?:\/\//, '');
        setCurrentURL(cleanLink);
      }
    } catch (err) {
      console.error("Failed to shorten link:", err);
      alert("Network error: Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  function myFunction() {
    if (!currentURL) {
      alert("No URL to copy! Click 'Get links' first.");
      return;
    }
    navigator.clipboard.writeText(currentURL)
      .then(() => alert("Copied: " + currentURL))
      .catch(err => console.error("Copy failed", err));
  }

  const divRef = useRef(null);
  const divRef1 = useRef(null);
  const divRef2 = useRef(null);
  const divRef3 = useRef(null);
  const divRef4 = useRef(null);

  const handleLinkOpen = (ref) => {
    if (ref.current && ref.current.textContent) {
      const link = ref.current.textContent.replace(/['"]/g, "").trim();
      if (link) window.open(link, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div>
      <div className='displaycover'>
        
        {/* RESPONSIVE WALLET BAR */}
        <div className="wallet-container">
          <div className="section label-section">
            Support us (Eth)
          </div>
          <div className="section address-section">
            {ethAddress}
          </div>
          <div className="section icon-section" onClick={handleEthCopy}>
            <img id='copy' className='capy' src={copy} alt="copy" />
          </div>
        </div>

        <Plink className="plink" href="https://profilertag.netlify.app" target="_blank" rel="noopener noreferrer">
          <button id='signlink'>Sign in</button>
        </Plink>
        
        <img src={bot} className='bot' alt="bot" />
        
        <div className='name'>
          {props.loadings ? <p>Loading data...</p> : <h1> {props.message} </h1>}
        </div>

        <h2 className='title'>About me ...</h2>
        <div id='about' className='birthinput'>{props.message1}</div>

        <h2 className='title'>Birthday</h2>
        <div className='birthinput'>{props.message2}</div>

        <h2 className='title'>Interests</h2>
        <Swiper className='swip' modules={[Autoplay]} autoplay={{ delay: 1000 }}>
          <SwiperSlide className='Swiperslide'>{props.message3}</SwiperSlide>
          <SwiperSlide className='Swiperslide'>{props.message4}</SwiperSlide>
          <SwiperSlide className='Swiperslide'>{props.message5}</SwiperSlide>
        </Swiper>

        <a className='gclink' ref={divRef} style={{ display: 'none' }}>{props.message7}</a>
        <a className='gclink' ref={divRef1} style={{ display: 'none' }}>{props.message9}</a>
        <a className='gclink' ref={divRef2} style={{ display: 'none' }}>{props.message11}</a>
        <a className='gclink' ref={divRef3} style={{ display: 'none' }}>{props.message13}</a>
        <a className='gclink' ref={divRef4} style={{ display: 'none' }}>{props.message15}</a>

        <div className='linkbtn' onClick={() => handleLinkOpen(divRef)}>
          {props.empty6s ? <p className='sociale'>Empty</p> : <div> {props.message6}</div>}
        </div>

        <h2 className='title'>Socials</h2>
        <div className='socialcover'>
          <div className='socialbtn' onClick={() => handleLinkOpen(divRef1)}>
            {props.empty8s ? <p className='sociale'>Empty link</p> : <div>{props.message8}</div>}
          </div>
          <div className='socialbtn' onClick={() => handleLinkOpen(divRef2)}>
            {props.empty10s ? <p className='sociale'>Empty link</p> : <div>{props.message10}</div>}
          </div>
          <div className='socialbtn' onClick={() => handleLinkOpen(divRef3)}>
            {props.empty12s ? <p className='sociale'>Empty link</p> : <div>{props.message12}</div>}
          </div>
          <div className='socialbtn' onClick={() => handleLinkOpen(divRef4)}>
            {props.empty14s ? <p className='sociale'>Empty link</p> : <div>{props.message14}</div>}
          </div>
        </div>

        <div className='gca'>
          <div 
            className='gco' 
            onClick={showCurrentURL} 
            style={{ 
              opacity: loading ? 0.6 : 1, 
              pointerEvents: loading ? 'none' : 'auto',
              cursor: 'pointer' 
            }}
          >
            {loading ? "..." : currentURL ? "Link Ready" : "Get bio url"}
          </div>
          
          <input 
            className='gci' 
            id='URL' 
            value={currentURL} 
            placeholder="Short link will appear here" 
            readOnly 
          />
          <div onClick={myFunction} className='gco' style={{ cursor: 'pointer' }}>
            <img id='copy' src={copy} alt="copy" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default Display;