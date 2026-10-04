import React from 'react';

// Food icons are drawn as a CSS mask so they take the surrounding text colour.
// The PNGs (<1KB each) are inlined as data URIs: a mask image loaded by URL is fetched
// again whenever the icon mounts (and goes network-first through the service worker),
// which left an icon blank or late when the food menu opened.
const CORN_MASK = 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAvCAYAAAClgknJAAAAAXNSR0IArs4c6QAAAklJREFUaEPtmY1NxDAMhX2bwCTAJMAkwCSwycEksAn0SbUUWWns5/ygky7SCaRrHX/xe04vPcmFj9OF5y9XgP+uYKYCNyLyKCL3+6eX4WcP8CEiX1vMTyYgC3AelHQrx1cReYtCRAGw6u8Lkte8UZUHEdHqHPJEAVasvE0SUgJEc0QAoHUAlAPBUWZKrweZoLpaYfwtBwCac0QA7OqHVsZbucr3SP5lk81T8R0kdNuKFQH4NQEQ0NVmAgC3AOLb3NvMkQVwVySZeHkbAEopXTxAs+JeBWxJV1SAkqwHgNLakrqdoUNGtY7XLSHbhZ43jWLbnzHQgbBh6sA8mO9wRCqA1obtXQe11ZOUSL5so+5cEQBb1ln7QE2ubrUjACuNTBkYxBGAVUamDcwArDAybWAGYIWRaQMzACuMbPcb18AMwAoj0wZmAGYbOWVgFmCmkVMGZgFmGjllYBZgppFTBmYBZho5ZWAWYJaR0wbOAKw4XnEfocsn3OizkN5jjUw+LYcudx+hewBq5Q5lRVwU2oE1HluB2rEHkVvoUurYhgVABiM3NLuB0YcGGQA7ac8vtO7FyADUZEQZbxdSzU+UfDJtVEVsVw6lh/mih7215Kn2mTWx3lerAiCQhPdy4qgVp86bMhJSiKOWqiD6ukiPz+/2IxN7hI54qeR7JKQQ1tChPmkuSic/AgAxAAFZ1Fa2BYRKQW5dp3w9EiqT0zeX5QleK/lM16rGGwVQmhvegN4Bhf+x0vhoh/JMTslwNAA1+YiLrwAjVrEnxh/1yo0w4dm1lQAAAABJRU5ErkJggg==")';
const FEED_MASK = 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAAXNSR0IArs4c6QAAAwFJREFUaEPtmb+uTUEUh383USo8AEEoFUoFwQOIwguQeACNQoVao9ERPIInQEgoFB6AIJQSSgkJ90tmJZOVvfes+bPvzZEzyc45OWfPmvX91loze2bvaMPbzob7ry3AfkdwZASuSjoq6ZikCwmM77TP6eL7C0kv3W/NOvQC4PT5XWf4bGnA3E1QLf2bawCFb2dKNw2edWoGaYnA84GOe/A7kp5m6VYUpgaAfH5ccP5JGvxLlhbkv9UE6WY1YvXhnSQa16IQNQBzyjMgquF8TQMKQaZAsEVtAL/YogDkO+HNG8ZRCoCeNgfCeEB0A6DQJ2elKswlJ9L/jOGjcbwUhUgEvPooj+E1mocoRiEC4HO/aLSDjPWEurBGpC8u2YsA/HUGIn06GFQ1XsSZr5IOZx6dk/S6x8OFvmclvcr+/ybpSG8E3kg6kxl5JOn6SgA+XYcAeKN/Ul6uEYXfkg6MrgFSCKfzKe6npEuDU+mHpEMussUZL1IDFBWzgT0O2BhA3dwd9H5nOj2UdGXCeRtz0ccoAD6Sj3kxm99EgxXzXWVE5hzH7tus7oYBLEHwHyDfE+izRGdQNySdknQiiUA65rmeB/G9pNPZD0MBsPtB0snOtJnrPmV7OAAGUfTegoq1fL8k3Ur1NHwhWzIICM9KBxthUPyBmwj2FCBXGpjLKX8BskauM2NxMRFwfVxYDPcNoDZt5u7fAnhlqhQZEIaq8WoWMvMt0qeHYwvw36WQ36cWN9od+eMPEIY8jXoAjlJqz4CiTDzxsv+wNgRgLzf1/gRkyKbenxSgCicFxVOzqOzZfascq5CXRCHfka1xtDJ1+lecsos3JHU4q/HvAIhC77Giie9zn99DIkUBpqJgg1Qdh0+k1ZQ43BbyLXRTGpQQEwV/fkkUal8b2esolPd7bYYLR7cGAMNzEA31OtulapquBWBU1ANk7gVFD0xY+d4HM5y3d2QjQMIvNLw6LRHIbZC/vDbi00AiQKwhVjd8Nq8pvQA96TKk7xZgiIwdRjY+Av8AB5OqMYzmCdgAAAAASUVORK5CYII=")';

interface IconProps {
    size?: number;
    className?: string;
}

const MaskIcon = ({ mask, size = 24, className = "" }: IconProps & { mask: string }) => (
    <div
        className={`bg-current ${className}`}
        style={{
            width: size,
            height: size,
            maskImage: mask,
            maskSize: "contain",
            maskRepeat: "no-repeat",
            maskPosition: "center",
            WebkitMaskImage: mask,
            WebkitMaskSize: "contain",
            WebkitMaskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
        }}
    />
);

export const CornIcon = (props: IconProps) => <MaskIcon mask={CORN_MASK} {...props} />;
export const FeedIcon = (props: IconProps) => <MaskIcon mask={FEED_MASK} {...props} />;
