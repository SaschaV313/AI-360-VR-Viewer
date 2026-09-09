export function createSphereMesh(widthSegments,heightSegments){
  const positions=[],uvs=[],indices=[],radius=500;
  for(let y=0;y<=heightSegments;y++){
    const v=y/heightSegments,phi=v*Math.PI;
    for(let x=0;x<=widthSegments;x++){
      const u=x/widthSegments,theta=u*Math.PI*2;
      positions.push(-radius*Math.sin(phi)*Math.cos(theta),radius*Math.cos(phi),radius*Math.sin(phi)*Math.sin(theta));
      uvs.push(1-u,1-v);
    }
  }
  for(let y=0;y<heightSegments;y++) for(let x=0;x<widthSegments;x++){const a=y*(widthSegments+1)+x,b=a+widthSegments+1;indices.push(a,b,a+1,b,b+1,a+1);}
  return{positions,uvs,indices};
}

export function makePerspective(fieldOfViewRadians,aspect,near,far){const f=Math.tan(Math.PI*0.5-0.5*fieldOfViewRadians),rangeInv=1/(near-far);return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(near+far)*rangeInv,-1,0,0,near*far*rangeInv*2,0]);}
export function makeLookAt(cameraPosition,target,up){const zAxis=normalize(subtract(cameraPosition,target)),xAxis=normalize(cross(up,zAxis)),yAxis=cross(zAxis,xAxis);return new Float32Array([xAxis[0],yAxis[0],zAxis[0],0,xAxis[1],yAxis[1],zAxis[1],0,xAxis[2],yAxis[2],zAxis[2],0,-dot(xAxis,cameraPosition),-dot(yAxis,cameraPosition),-dot(zAxis,cameraPosition),1]);}
export function subtract(a,b){return[a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
export function cross(a,b){return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
export function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
export function normalize(v){const length=Math.hypot(v[0],v[1],v[2])||1;return[v[0]/length,v[1]/length,v[2]/length];}
export function clamp(value,min,max){return Math.min(max,Math.max(min,value));}
export function degToRad(degrees){return degrees*Math.PI/180;}
export function radToDeg(radians){return radians*180/Math.PI;}
export function quaternionFromEulerYXZ(x,y,z){
  const c1=Math.cos(x/2),c2=Math.cos(y/2),c3=Math.cos(z/2),s1=Math.sin(x/2),s2=Math.sin(y/2),s3=Math.sin(z/2);
  return[
    s1*c2*c3+c1*s2*s3,
    c1*s2*c3-s1*c2*s3,
    c1*c2*s3-s1*s2*c3,
    c1*c2*c3+s1*s2*s3
  ];
}
export function quaternionFromAxisAngle(axis,angle){const half=angle/2,s=Math.sin(half);return[axis[0]*s,axis[1]*s,axis[2]*s,Math.cos(half)];}
export function quaternionMultiply(a,b){return[
  a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],
  a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
  a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],
  a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]
];}
export function quaternionInvert(q){const lengthSq=q[0]*q[0]+q[1]*q[1]+q[2]*q[2]+q[3]*q[3]||1;return[-q[0]/lengthSq,-q[1]/lengthSq,-q[2]/lengthSq,q[3]/lengthSq];}
export function quaternionNormalize(q){const length=Math.hypot(q[0],q[1],q[2],q[3])||1;return[q[0]/length,q[1]/length,q[2]/length,q[3]/length];}
export function rotateVectorByQuaternion(v,q){
  const p=[v[0],v[1],v[2],0];
  const result=quaternionMultiply(quaternionMultiply(q,p),quaternionInvert(q));
  return[result[0],result[1],result[2]];
}


export function shortestAngleDelta(target, current) { return ((target - current + 180) % 360 + 360) % 360 - 180; }
export function unwrapAngle(reference, value) { return reference + shortestAngleDelta(value, reference); }
