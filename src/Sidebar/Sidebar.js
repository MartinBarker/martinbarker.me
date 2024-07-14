import React, { useEffect } from 'react'

//const images = importAll(require.context('../../aesthetic-images/', (false), (/^\.\/.*$/), ('sync')))
//const thumbnails = importAll(require.context('../../aesthetic-images/thumbnails/', (false), (/^\.\/.*$/), ('sync')))


const Sidebar = ({ children }) => {
    return (
        <>
            <h1>Sidebar</h1>
            {children}
        </>
    )
}

export default Sidebar